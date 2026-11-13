# Driver App Audit Findings & Remediation Catalog

- **Audit Date:** 2026-11-12
- **Audit Target:** Vahanly Driver Application (`client-app/`, `workers/api/`, `workers/cron/`, `database/migrations/`)
- **Benchmark:** DriveU Partner Android Platform (`com.driveu.partner` v11.24.28 reverse engineering artifacts)
- **Status:** **CRITICAL BLOCKERS IDENTIFIED (P0) — LAUNCH PROHIBITED**

---

## 1. Summary of Driver App Findings

| Finding ID | Title | Category | Priority | Effort | Confidence |
|:---|:---|:---|:---:|:---:|:---:|
| **FIND-DRV-001** | Universal Backdoor OTP `1234` in Production Trip Verification Handler | Security Vulnerability | **P0** | XS | High |
| **FIND-DRV-002** | Driver Dispatch Offer & Acceptance Loop Disconnected in Edge Backend | Cross-Role Workflow Gap | **P0** | M | High |
| **FIND-DRV-003** | In-Transit Order Events Endpoint Missing (`/orders/:id/events` 404s) | Implementation Defect | **P0** | S | High |
| **FIND-DRV-004** | Web Geolocation Halts Background GPS Streaming During Locked Screen or Navigation | Mobile Lifecycle / Architecture | **P0** | L | High |
| **FIND-DRV-005** | Vehicle Inspection & Odometer Start/End Metrics Dropped by Backend | Operational / Billing Integrity | **P1** | S | High |
| **FIND-DRV-006** | Hardcoded Driver Stats and Earnings Returning Static Mock Constants | Financial Integrity | **P1** | M | High |
| **FIND-DRV-007** | Driver Onboarding KYC Document Upload Routes 404 on Cloudflare Edge | Operational Readiness Gap | **P1** | M | High |
| **FIND-DRV-008** | Scheduled Advance Booking Commitment & Lead-Time Routes Missing | Feature Parity Gap | **P1** | M | High |
| **FIND-DRV-009** | Tab Bar Redesign Points to `/driver/jobs` (History Only); Scheduled Bookings Orphaned | Information Architecture / UX | **P1** | S | High |
| **FIND-DRV-010** | Missing Cash Collection and Driver Wallet Commission Deductions at Trip End | Financial Correctness | **P1** | M | High |
| **FIND-DRV-011** | Emergency Contact Profile Modification Endpoint (`/profile/emergency-contact`) 404s | Safety & Compliance | **P2** | XS | High |
| **FIND-DRV-012** | Outdated Infrastructure Assumptions in Redesign Plan (Kafka, VM, Docker) | Architecture / Technical Debt | **P2** | S | High |
| **FIND-DRV-013** | Taxi Fleet Vehicle Registration Confuses Driver-on-Hire Model | Business Model / UX Alignment | **P2** | S | High |
| **FIND-DRV-014** | Placeholder FCM VAPID Key in Driver App Configuration | Integration & Push Delivery | **P2** | XS | High |

---

## 2. Detailed Finding Specifications

---

### FIND-DRV-001: Universal Backdoor OTP `1234` in Production Trip Verification Handler

- **Category:** Security Vulnerability
- **Severity / Priority:** **CRITICAL / P0 (Release Blocker)**
- **Evidence:** `workers/api/src/routes/driver.ts#L151-L153`
  ```ts
  if (rows[0].start_otp !== body.otp && body.otp !== '1234') {
    return c.json({ success: false, error: 'invalid OTP' }, 400);
  }
  ```
- **Failure Scenario:**
  1. A driver is assigned to a trip or force-matched.
  2. The driver never meets the rider or arrives at a completely wrong location.
  3. The driver inputs `1234` as the start OTP in `ArrivedVerificationPane.tsx`.
  4. The Cloudflare Worker validates the hardcoded backdoor code, marks the order `IN_TRANSIT`, starts charging the customer's payment method, and prevents the customer from cancelling without penalty.
  5. Malicious drivers can initiate fraudulent phantom trips without the customer ever being present.
- **Remediation:** Remove the `body.otp !== '1234'` condition completely. Require an exact string match against the cryptographic 4-digit PIN generated during order creation (`orders.start_otp`). Enforce a maximum of 3 failed OTP attempts with temporary lockout to prevent brute-force attacks.
- **Effort:** XS (< 1 hour)
- **Confidence:** High
- **Acceptance Criteria:**
  - Submitting `1234` against an order with `start_otp = '8492'` returns HTTP 400 with `{ success: false, error: 'invalid OTP' }`.
  - Only the exact match initiates `IN_TRANSIT` status and broadcasts `trip.started`.

---

### FIND-DRV-002: Driver Dispatch Offer & Acceptance Loop Disconnected in Edge Backend

- **Category:** Cross-Role Workflow Gap
- **Severity / Priority:** **CRITICAL / P0 (Release Blocker)**
- **Evidence:**
  - `workers/api/src/queue.ts#L33-L73` (bypasses offer phase; directly forces `UPDATE orders SET status = 'ASSIGNED'`).
  - `workers/api/src/routes/driver.ts` (omits `GET /api/v1/driver/offer` and `PATCH /api/v1/driver/orders/:id/offer-response`).
  - `client-app/src/api/client.ts#L521` (calls `PATCH /api/v1/driver/orders/${orderId}/offer-response`, which 404s).
  - `client-app/src/store/useOfferStore.ts#L92-L99` (fails silently and reverts state).
- **Failure Scenario:**
  1. Customer books a driver. The backend queue matches the order to driver `D1`.
  2. Instead of generating a 15-second dispatch offer, `queue.ts` immediately forces the database order status to `ASSIGNED` and tells the rider a driver is assigned.
  3. Driver `D1` is connected to WebSocket `global-driver`, while `queue.ts` broadcasts the assignment only to `OrderStreamDO(orderId)`. The driver never receives the offer or assignment.
  4. If the driver app polls `/api/v1/driver/offer`, it receives a 404.
  5. Even if the driver UI somehow mounted `OfferScreen`, tapping "Accept" calls `/orders/:id/offer-response`, which 404s, throwing an error and reverting the driver's screen.
  6. The booking remains in `ASSIGNED` forever while the driver never shows up.
- **Remediation:**
  1. Update `queue.ts` to transition order to `OFFERED`, insert a record into `dispatch_offers` with a 15-second TTL, and broadcast `driver.offer` to the specific driver's active WebSocket or FCM push.
  2. Implement `GET /api/v1/driver/offer` in `workers/api/src/routes/driver.ts` returning active offer details and remaining seconds.
  3. Implement `PATCH /api/v1/driver/orders/:id/offer-response` to handle `ACCEPTED` (transitions order to `ASSIGNED` and driver to `BUSY`) or `DECLINED` (re-queues order to next candidate).
- **Effort:** M (2-3 days)
- **Confidence:** High
- **Acceptance Criteria:**
  - Creating an order triggers an offer received by the targeted driver within 1.5 seconds.
  - Driver sees `OfferScreen` with full details and countdown.
  - Tapping "Accept" transitions the order to `ASSIGNED` and navigates the driver to `EN_ROUTE`.
  - Tapping "Decline" or allowing 15s timeout unlocks the driver and re-dispatches the trip.

---

### FIND-DRV-003: In-Transit Order Events Endpoint Missing (`/orders/:id/events` 404s)

- **Category:** Implementation Defect
- **Severity / Priority:** **CRITICAL / P0 (Release Blocker)**
- **Evidence:**
  - `client-app/src/api/client.ts#L1234-L1246` calls `POST /api/v1/driver/orders/${orderId}/events` with body `{ type, toll_amount_paise, parking_amount_paise, notes }`.
  - `workers/api/src/routes/driver.ts` does NOT register `/api/v1/driver/orders/:id/events`.
- **Failure Scenario:**
  1. During an in-city or outstation trip, the driver passes through a toll plaza (e.g. Second Hooghly Bridge or Vidyasagar Setu) and pays ₹120 in cash/FASTag.
  2. The driver opens the expense drawer in `TripInProgressPane.tsx` and enters ₹120 toll.
  3. The app fires `addOrderEvent()`, which fails with HTTP 404 Not Found.
  4. The toll charge is dropped. At trip end, the final bill does not include the toll.
  5. The driver loses personal money for customer tolls, causing immediate driver churn and disputes.
- **Remediation:** Implement `POST /api/v1/driver/orders/:id/events` in `workers/api/src/routes/driver.ts`. Store events in an `order_events` table and atomically increment `orders.extra_charges_paise` and `orders.toll_charges_paise`. Broadcast `order.expense_added` to `OrderStreamDO`.
- **Effort:** S (4 hours)
- **Confidence:** High
- **Acceptance Criteria:**
  - Driver can add toll and parking fees mid-trip.
  - Extra charges are saved in PostgreSQL and immediately appear on the rider's live trip bill.

---

### FIND-DRV-004: Web Geolocation Halts Background GPS Streaming During Locked Screen or Navigation

- **Category:** Mobile Lifecycle / Platform Gap
- **Severity / Priority:** **CRITICAL / P0 (Mobile Operational Blocker)**
- **Evidence:**
  - `client-app/src/services/telemetryStream.ts#L85-L125` relies exclusively on browser `navigator.geolocation.watchPosition`.
  - `client-app/src/lib/map/navigation.ts#L1-L40` opens external Google Maps via `window.open('google.navigation:q=...')`.
  - `client-app/package.json` lacks background geolocation native plugins.
- **Failure Scenario:**
  1. Driver accepts a trip and taps "Navigate in Google Maps".
  2. Android brings Google Maps to the foreground; the Vahanly web app tab is backgrounded.
  3. Within 30 to 60 seconds, Android OS throttles background JavaScript timers. `navigator.geolocation` stops firing.
  4. The driver's location freezes on the customer's map and in the admin control room.
  5. `CityDispatchDO` prunes the driver as inactive; customer panics thinking the driver has disappeared.
- **Remediation:** Integrate `@capacitor-community/background-geolocation` into `client-app`. Configure a persistent Android Foreground Service notification ("Vahanly Driver — On Active Duty") that keeps native GPS running and sends telemetry even when the screen is locked or Google Maps is navigation leader.
- **Effort:** L (3-4 days)
- **Confidence:** High
- **Acceptance Criteria:**
  - Locking the phone or switching to Google Maps navigation continues to broadcast GPS fixes to `POST /api/v1/driver/location` every 5 seconds.
  - Rider map reflects live movement continuously without freezing.

---

### FIND-DRV-005: Vehicle Inspection & Odometer Start/End Metrics Dropped by Backend

- **Category:** Operational / Billing Integrity
- **Severity / Priority:** **HIGH / P1**
- **Evidence:**
  - `client-app/src/app/driver/page.tsx#L183-L194` collects `startOdometer`, `startFuel`, `startOdoPhoto`, `endOdometer`, `endFuel`.
  - `client-app/src/api/client.ts#L1171,L1260` submits these in request bodies.
  - `workers/api/src/routes/driver.ts#L141,L171` (`verify-otp` and `end`) completely ignores odometer and fuel fields in the handler.
- **Failure Scenario:**
  1. In the rider-owns-car model, a driver takes customer's Honda City. The starting odometer is 35,400 km.
  2. Driver enters `35400` in the app. The backend handler drops the field.
  3. At the end of the day, customer claims the driver took the car for a 100 km joyride.
  4. Operations has zero odometer records in the database to adjudicate the dispute.
- **Remediation:** Add `start_odometer_km`, `end_odometer_km`, `start_fuel_pct`, `end_fuel_pct`, `odometer_photo_url` columns to `orders` table in Neon Postgres. Update `verify-otp` and `end` handlers to validate and persist these values.
- **Effort:** S (4 hours)
- **Confidence:** High
- **Acceptance Criteria:**
  - Odometer readings are required at trip start and trip end.
  - Total trip distance computed from odometer difference is stored and compared against GPS distance for fraud audits.

---

### FIND-DRV-006: Hardcoded Driver Stats and Earnings Returning Static Mock Constants

- **Category:** Financial Integrity
- **Severity / Priority:** **HIGH / P1**
- **Evidence:** `workers/api/src/routes/driver.ts#L104-L115,L221-L228`
  ```ts
  driver.get('/api/v1/driver/earnings', async (c) => {
    return c.json({
      total_earnings_paise: 4500000,
      withdrawable_paise: 3800000,
      trips_count: 142,
      this_week_earnings_paise: 1250000,
    });
  });
  ```
- **Failure Scenario:**
  1. A brand-new driver registers on the platform and completes 1 trip worth ₹400.
  2. Driver opens the "Earn" tab. The app displays "Withdrawable Balance: ₹38,000" and "Total Earnings: ₹45,000".
  3. Driver taps "Request Instant Payout".
  4. The app fires `/api/v1/driver/payouts/request` for ₹38,000.
  5. The platform's automated payout workflow initiates a massive fraudulent bank transfer.
- **Remediation:** Remove hardcoded constants immediately. Create a `driver_wallet_ledger` table. Compute `withdrawable_paise` dynamically by summing completed trip net earnings minus platform commission minus already-settled payouts.
- **Effort:** M (2 days)
- **Confidence:** High
- **Acceptance Criteria:**
  - A driver with 0 completed trips sees ₹0 withdrawable balance.
  - Completing a trip accurately increments the balance by the net driver payout amount.

---

### FIND-DRV-007: Driver Onboarding KYC Document Upload Routes 404 on Cloudflare Edge

- **Category:** Operational Readiness Gap
- **Severity / Priority:** **HIGH / P1**
- **Evidence:**
  - `client-app/src/api/client.ts#L911-L1095` calls `/api/v1/driver/onboarding/*`.
  - `workers/api/src/routes/` has no onboarding routes registered.
- **Failure Scenario:**
  1. New driver registers and completes phone OTP verification.
  2. Driver proceeds to upload Driving License and Aadhaar photos.
  3. App calls `/api/v1/driver/onboarding/presigned-url`.
  4. Backend returns 404. Upload fails. Driver is permanently blocked from completing onboarding.
- **Remediation:** Implement `POST /api/v1/driver/onboarding/presigned-url` using Cloudflare R2 bucket binding (`env.DOCUMENTS_BUCKET.put()`). Implement step verification handlers updating `driver_documents` and `drivers.onboarding_step`.
- **Effort:** M (2 days)
- **Confidence:** High
- **Acceptance Criteria:**
  - Driver can upload license and Aadhaar photos directly to Cloudflare R2.
  - Document status is set to `SUBMITTED` and visible in the Admin Control Room for human review.

---

### FIND-DRV-008: Scheduled Advance Booking Commitment & Lead-Time Routes Missing

- **Category:** Feature Parity Gap
- **Severity / Priority:** **HIGH / P1**
- **Evidence:**
  - `client-app/src/api/client.ts#L576,L591,L596` calls `/api/v1/driver/trips/upcoming` and `/api/v1/driver/scheduled-offers/*`.
  - `workers/api/src/routes/driver.ts` does NOT implement these endpoints.
- **Failure Scenario:**
  1. Customer books a driver for tomorrow at 8:00 AM (outstation round trip).
  2. The booking sits in the database with `scheduled_at` set.
  3. No driver is able to see or commit to this advance trip because the upcoming trips endpoints return 404.
  4. Tomorrow morning arrives, and no driver is dispatched. The customer's flight or wedding commute is missed.
- **Remediation:** Implement `GET /api/v1/driver/scheduled-offers` (returns open scheduled bookings in the driver's city) and `POST /api/v1/driver/scheduled-offers/:id/accept` (commits driver to the booking). In `workers/cron`, trigger lead-time dispatch at `T-40 minutes`.
- **Effort:** M (2 days)
- **Confidence:** High
- **Acceptance Criteria:**
  - Scheduled trips appear in the driver's "Jobs / Upcoming" tab.
  - Committing to a scheduled trip reserves the driver and sets up automated dispatch alarms at T-40 minutes.

---

### FIND-DRV-009: Tab Bar Redesign Points to `/driver/jobs` (History Only); Scheduled Bookings Orphaned

- **Category:** Information Architecture / UX
- **Severity / Priority:** **HIGH / P1**
- **Evidence:**
  - `client-app/src/components/TabBarRedesign.tsx#L61` links Tab 2 to `/driver/jobs`.
  - `client-app/src/app/driver/jobs/page.tsx` renders `JobsListScreen` displaying only completed past trips.
  - `client-app/src/app/driver/trips/page.tsx` contains the full `UPCOMING` + `HISTORY` segmented tabs with `ScheduledOffersList`, but uses the obsolete `TabBar` component and is unreachable from primary navigation.
- **Failure Scenario:**
  1. Driver looks for committed upcoming bookings or available advance jobs.
  2. Driver taps the second tab ("Jobs") in the bottom bar.
  3. Only completed past trips are displayed. There is no button, tab, or link to view upcoming jobs.
  4. The entire advance booking capability is orphaned and hidden from users.
- **Remediation:** Update `TabBarRedesign.tsx` Tab 2 to route to `/driver/trips`. Ensure `/driver/trips` features a top segmented control switching between "Upcoming" (advance commitments) and "History" (past trips). Deprecate redundant `/driver/jobs` route.
- **Effort:** S (3 hours)
- **Confidence:** High
- **Acceptance Criteria:**
  - Tapping Tab 2 opens the unified Trips page.
  - Drivers can seamlessly toggle between Upcoming scheduled bookings and past completed history.

---

### FIND-DRV-010: Missing Cash Collection and Driver Wallet Commission Deductions at Trip End

- **Category:** Financial Correctness
- **Severity / Priority:** **HIGH / P1**
- **Evidence:** `workers/api/src/routes/driver.ts#L171-L205` (`driver.patch('/api/v1/driver/orders/:id/end')`).
- **Failure Scenario:**
  1. A cash booking of ₹850 completes.
  2. Customer hands ₹850 cash to the driver.
  3. Driver taps "End Trip". The backend marks the trip `COMPLETED`.
  4. The platform commission (e.g., 20% = ₹170) is never debited from the driver's wallet.
  5. Driver keeps the full ₹850 cash, and the platform collects zero revenue.
- **Remediation:** Implement a post-trip payment settlement flow. If payment mode is `CASH`, require driver confirmation. Automatically debit platform commission (₹170) from the driver's wallet balance. If wallet balance falls below negative limit (-₹500), restrict driver from going online until balance is recharged.
- **Effort:** M (2 days)
- **Confidence:** High
- **Acceptance Criteria:**
  - Cash trip completion records cash collected by driver and debits platform commission from driver ledger.
  - Driver ledger balance accurately reflects cash retained vs digital payouts owed.

---

### FIND-DRV-011: Emergency Contact Profile Modification Endpoint (`/profile/emergency-contact`) 404s

- **Category:** Safety & Compliance
- **Severity / Priority:** **MEDIUM / P2**
- **Evidence:** `client-app/src/api/client.ts#L1604` calls `PATCH /api/v1/driver/profile/emergency-contact`; route is missing in `workers/api/src/routes/driver.ts`.
- **Failure Scenario:**
  1. Driver gets married or changes family phone number and attempts to update their emergency SOS contact in Account -> Safety Center.
  2. The update fails with 404.
  3. If the driver is later involved in an accident and triggers SOS, emergency dispatchers attempt to call an outdated, disconnected emergency contact.
- **Remediation:** Implement `PATCH /api/v1/driver/profile/emergency-contact` in `workers/api/src/routes/driver.ts` saving `name`, `phone`, and `relationship` into `drivers.emergency_contact` JSONB.
- **Effort:** XS (2 hours)
- **Confidence:** High
- **Acceptance Criteria:**
  - Updating emergency contact in settings persists to database and is returned upon subsequent `/driver/me` profile queries.

---

### FIND-DRV-012: Outdated Infrastructure Assumptions in Redesign Plan (Kafka, VM, Docker)

- **Category:** Architecture / Technical Debt
- **Severity / Priority:** **MEDIUM / P2**
- **Evidence:** `DOC/DRIVER_APP_REDESIGN_PLAN.md#L111-L123` describes Kafka consumers, Docker Compose OSRM containers, and VM redeployments, contradicting `DOC/ADR-cloudflare-migration.md`.
- **Failure Scenario:**
  1. An engineer picks up the 2026-07-09 redesign plan and attempts to configure Kafka notification dispatchers or spin up Docker OSRM on a GCP VM that no longer exists.
  2. Wastes engineering effort attempting to interface with deprecated infrastructure.
- **Remediation:** Formally deprecate `DOC/DRIVER_APP_REDESIGN_PLAN.md` and replace it with `DRIVER_APP_REDESIGN_PLAN_V2_PROPOSED.md` rooted in the Cloudflare edge architecture (`workers/api`, Durable Objects, Neon, R2).
- **Effort:** S (Documentation update)
- **Confidence:** High
- **Acceptance Criteria:**
  - Architecture documentation reflects Cloudflare Workers, Durable Objects, and Neon Postgres exclusively.

---

### FIND-DRV-013: Taxi Fleet Vehicle Registration Confuses Driver-on-Hire Model

- **Category:** Business Model / UX Alignment
- **Severity / Priority:** **MEDIUM / P2**
- **Evidence:** `client-app/src/app/driver-account/vehicles/page.tsx` and `workers/api/src/routes/driver.ts#L281-L315`.
- **Failure Scenario:**
  1. In a driver-service app (like DriveU), the driver drives the **customer's car**. Drivers do not own commercial cabs.
  2. A new driver sees "My Vehicles (Add Sedan, Hatchback, License Plate)" prominently in the Account tab.
  3. Driver believes they need to own and register a commercial taxi to work for Vahanly, leading to onboarding drop-offs and confusion.
- **Remediation:** Remove "Vehicles" from the driver primary navigation and Account tab. Replace with "Driving Skill Profile" (transmission expertise: Manual, Automatic, Luxury EVs).
- **Effort:** S (4 hours)
- **Confidence:** High
- **Acceptance Criteria:**
  - Driver Account navigation no longer prompts drivers to register personal cars.
  - Driver profile records transmission proficiencies instead.

---

### FIND-DRV-014: Placeholder FCM VAPID Key in Driver App Configuration

- **Category:** Integration & Push Delivery
- **Severity / Priority:** **MEDIUM / P2**
- **Evidence:** `DOC/DRIVER_APP_OPEN_ISSUES.md#L102`
  ```
  client-app/.env.local: NEXT_PUBLIC_FCM_VAPID_KEY=your_vapid_public_key_here
  ```
- **Failure Scenario:**
  1. Driver logs in. `registerDriverPushNotifications()` executes in `src/app/login/page.tsx`.
  2. The browser attempts to register for Web Push using the dummy key `your_vapid_public_key_here`.
  3. The browser rejects the registration; no FCM token is generated; driver receives zero background push notifications for dispatch offers.
- **Remediation:** Provision a valid Firebase Cloud Messaging Web Push certificate (VAPID key) in Firebase Console under project `vahnly-platform`. Populate in `client-app/.env.local` and environment secrets.
- **Effort:** XS (1 hour)
- **Confidence:** High
- **Acceptance Criteria:**
  - Successful login registers a real FCM token and posts it to `/api/v1/driver/device-token`.
