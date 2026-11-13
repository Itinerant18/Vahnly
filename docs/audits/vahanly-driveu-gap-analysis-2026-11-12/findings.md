# Detailed Findings Catalog: Vahanly Platform Audit

- **Date:** 2026-11-12
- **Audit Target:** Vahanly Architecture, Codebase & Parity Deficiencies
- **Auditor:** Principal Software Engineer & QA Lead

---

### FIND-001: BookingSheet Crash on Submit Due to API Envelope Mismatch

- **Category:** Vahanly implementation defect
- **Relevant Role and Journey:** Customer (Rider) — Journey 1 (Booking Creation Funnel)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** XS (< 2 hours)
- **Confidence:** High
- **Current Vahanly Behavior:** When a customer selects pickup/dropoff points and clicks "Book Driver", `handleConfirmBooking` invokes `bookDriver()`. In `rider-app/src/lib/store/bookingStore.ts#L310`, the function expects the API to return `{ order: Order, otp: string }` and returns `{ order: res.order, otp: res.otp }`. However, `workers/api/src/routes/orders.ts#L163` returns `{ success: true, order_id: string, status: string, ... }`. Because `res.order` is `undefined`, `BookingSheet.tsx#L539` executes `router.push('/dispatch?orderId=' + order.id)`, throwing an uncaught `TypeError: Cannot read properties of undefined (reading 'id')`. The booking flow immediately halts, and the user receives a generic "Booking failed" toast.
- **Expected Behavior:** `workers/api` must return the order object matching the `CreateOrderResult` schema (`{ order: { id, status, ... }, otp, fare_estimate }`), or the client must read `res.order_id` safely and navigate to `/dispatch?orderId=${res.order_id}`.
- **DriveU Evidence:** DriveU's booking creation returns the full active booking entity (`driver/upcoming-bookings/`, `driver/app-home/`).
- **Vahanly Evidence:** 
  - `rider-app/src/components/booking/BookingSheet.tsx#L538-L539`
  - `rider-app/src/lib/store/bookingStore.ts#L310`
  - `workers/api/src/routes/orders.ts#L163-L173`
- **Search Scope:** Scoped to `rider-app` order submission pipeline and `workers/api` order creation handler.
- **User/Business Impact:** 100% of customer booking attempts on the rider web/mobile app crash. Zero customer conversion is possible.
- **Failure Scenario:** Rider downloads app, logs in, selects pickup location, taps "Book Driver", confirms fare. The app displays "Booking failed" and stays on the map. In the database, the order is actually created, stranding orphaned orders in Postgres.
- **Root Cause:** Schema drift during the Cloudflare migration. The Go gateway returned an envelope containing `order`, while the Hono worker returned a flat object with `order_id`.
- **Recommended Solution:** Update `workers/api/src/routes/orders.ts` to return the complete order object formatted as `{ order: { id: orderId, status: 'SEARCHING', ... }, otp, fare_paise }`.
- **Affected Layers:** Frontend (`rider-app`), Backend (`workers/api`).
- **Dependencies:** None.
- **Acceptance Criteria:** Tapping "Book Driver" successfully transitions the client to `/dispatch?orderId=<uuid>` without JavaScript console errors.
- **Required Tests:** End-to-end booking submission test verifying client navigation to `/dispatch`.

---

### FIND-002: Bypassed Driver Job Offer Flow & Missing Offer Routes in Edge API

- **Category:** Cross-role workflow gap
- **Relevant Role and Journey:** Driver Partner — Journey 1 & 4 (Dispatch & Acceptance)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** M (2–3 days)
- **Confidence:** High
- **Current Vahanly Behavior:** When an order is created, `workers/api/src/queue.ts#L33-L41` matches a driver in `CityDispatchDO` and immediately updates PostgreSQL: `SET status = 'ASSIGNED', driver_id = matchResult.driverId`. It never creates an offer record. Meanwhile, `client-app` attempts to poll `GET /api/v1/driver/offer` (`client-app/src/api/client.ts#L467`), which **does not exist** on `workers/api` (returns 404). Furthermore, `PATCH /api/v1/driver/orders/:id/offer-response` (accept/decline) does not exist in `workers/api`.
- **Expected Behavior:** Matching must place the order in an `OFFERED` state for the candidate driver with a 15-second expiration timer. The driver terminal must receive the offer, ring the incoming modal (`OfferScreen.tsx`), and allow the driver to accept or decline. Only upon driver acceptance should the order become `ASSIGNED`.
- **DriveU Evidence:** `FEATURE_FUNCTIONALITY.md` §1 & §5.3: DriveU launches `IncomingActivity` with sound and countdown, calling `driver/opt-booking/v2/` to accept or `driver/reject-booking/` with a cancellation reason.
- **Vahanly Evidence:**
  - `workers/api/src/routes/driver.ts` (lacks `/offer` and `/offer-response` routes)
  - `workers/api/src/queue.ts#L33-L73` (forces immediate `ASSIGNED`)
  - `client-app/src/store/useOfferStore.ts#L58,L92`
  - `client-app/src/api/client.ts#L467,L514`
- **Search Scope:** Complete text search across `workers/api` for `offer-response` and `/driver/offer`.
- **User/Business Impact:** Drivers never receive job offers on their screens. Orders are auto-assigned without driver consent, leading to 100% driver no-shows and stranded riders.
- **Failure Scenario:** Rider books a ride. Driver terminal sits on the map idling. Rider app says "Driver Assigned", but the assigned driver has no idea they were assigned a trip and walks away.
- **Root Cause:** The Go gateway implemented `HandleDriverGetOffer` and `HandleOfferResponse` (`cmd/gateway/main.go#L643`), but these were skipped during the Cloudflare Worker port.
- **Recommended Solution:** Port `driver_offer` table and DO matching logic. Implement `GET /api/v1/driver/offer` and `PATCH /api/v1/driver/orders/:id/offer-response` in `workers/api/src/routes/driver.ts`.
- **Affected Layers:** Backend (`workers/api`, `CityDispatchDO`), Frontend (`client-app`), Database.
- **Dependencies:** `CityDispatchDO` offer reservation state.
- **Acceptance Criteria:** Drivers receive a 15-second incoming offer ring and must actively slide/tap Accept before the trip transitions to `ASSIGNED`.
- **Required Tests:** Concurrent offer acceptance test and offer rejection fallback test.

---

### FIND-003: Simulated Client-Side Payments in Rider Bill Screen with Competitor VPA Leak

- **Category:** Security / Financial Risk
- **Relevant Role and Journey:** Customer (Rider) — Journey 1 & 7 (Payment & Fare Settlement)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** L (4–5 days)
- **Confidence:** High
- **Current Vahanly Behavior:** In `rider-app/app/(app)/trip/bill/page.tsx#L125-L138`, payment processing is completely fake:
  1. **UPI:** Generates a hardcoded intent URL `upi://pay?pa=d4m@ybl&pn=DriverforU&am=${amount}&tn=Order+${orderId}&cu=INR`, launches the system intent, and executes `setTimeout(() => setPaid(true), 800)`.
  2. **Wallet:** Runs `setTimeout(() => setPaid(true), 1200)`. The server wallet balance is never checked or debited.
  3. **Card:** Instantly sets `setPaid(true)`.
  No backend API is called. The order in PostgreSQL is never marked `PAID`. Competitor branding (`d4m@ybl` and `DriverforU`, referring to Drivers4Me) is exposed directly to customers.
- **Expected Behavior:** The client must call `POST /api/v1/payments/initiate` to generate a server-signed payment order (Juspay / Razorpay / Cashfree SDK or dynamic UPI QR/Intent). Payment confirmation must be verified server-side via cryptographic webhook before marking the order `PAID` and issuing a receipt.
- **DriveU Evidence:** `DEEP_DIVE_REPORT.md` §5 & `FEATURE_FUNCTIONALITY.md` §5.4: DriveU integrates native Juspay HyperSDK (`JuspayCheckoutActivity`), supporting UPI intents, cards, netbanking, and server-verified cash collection via `payment/cash_payment/`.
- **Vahanly Evidence:** `rider-app/app/(app)/trip/bill/page.tsx#L125-L138`.
- **Search Scope:** `rider-app` payment handling and `workers/api/src/routes/payments.ts`.
- **User/Business Impact:** Total revenue leakage. Customers ride for free because the UI claims payment is complete without collecting funds. Legal and brand risk from displaying competitor VPA `d4m@ybl`.
- **Failure Scenario:** Rider finishes a ₹500 trip, selects UPI, cancels the UPI app prompt, returns to Vahanly. The app displays "Payment Successful" with a green checkmark. Driver never gets paid; platform records zero revenue.
- **Root Cause:** Placeholder implementation during UI development was never replaced with real payment gateway SDK integration.
- **Recommended Solution:** Integrate Juspay HyperSDK (or Razorpay Standard Checkout) on the client. Add `POST /api/v1/payments/create-order` and `POST /api/v1/payments/verify` on `workers/api`. Remove all hardcoded `d4m@ybl` strings.
- **Affected Layers:** Frontend (`rider-app`), Backend (`workers/api`), External Gateway.
- **Dependencies:** Payment aggregator merchant credentials.
- **Acceptance Criteria:** Payments must be cryptographically verified server-side before the receipt screen is unlocked.
- **Required Tests:** End-to-end UPI and Card payment verification tests with gateway webhook replay testing.

---

### FIND-004: In-Transit Order Events Endpoint Missing (`/orders/:id/events` 404)

- **Category:** Vahanly implementation defect
- **Relevant Role and Journey:** Driver Partner — Journey 1 & In-Trip Execution
- **Priority:** **P0** (Launch Blocker)
- **Effort:** S (1 day)
- **Confidence:** High
- **Current Vahanly Behavior:** When a driver adds a toll charge, adds parking fees, or reports a customer no-show (`TripInProgressPane.tsx#L84` and `ArrivedVerificationPane.tsx#L286`), the client calls `addOrderEvent()` (`POST /api/v1/driver/orders/:id/events`). This route **does not exist** in `workers/api/src/routes/driver.ts`. The call fails with 404. Tolls and parking cannot be added to the fare, and no-shows cannot be recorded.
- **Expected Behavior:** `workers/api` must provide `POST /api/v1/driver/orders/:id/events` to persist extra fees (`TOLL`, `PARKING`, `WAITING`, `NO_SHOW`) into `order_events` or `order_fare_breakdowns`, recalculating the final bill.
- **DriveU Evidence:** DriveU provides `driver/b2b-action/` and `driver/driver-checkout-booking/` for itemized modifications (`analysis/api_endpoints.txt`).
- **Vahanly Evidence:**
  - `client-app/src/app/driver/trip/live/TripInProgressPane.tsx#L84`
  - `client-app/src/app/driver/trip/live/ArrivedVerificationPane.tsx#L286`
  - `client-app/src/api/client.ts#L1225`
  - `workers/api/src/routes/driver.ts` (endpoint absent)
- **Search Scope:** Scoped search for `/events` in `workers/api`.
- **User/Business Impact:** Drivers cannot pass through toll booths or parking structures without paying out-of-pocket, as they have no mechanism to add these legitimate fees to the trip fare.
- **Failure Scenario:** Driver pays ₹120 toll on Vidyasagar Setu. Taps "Add Toll" in driver app. App displays error toast "Failed to add charge". Driver loses ₹120 of their earnings.
- **Root Cause:** Omission of the order events route during the Hono backend migration.
- **Recommended Solution:** Implement `POST /api/v1/driver/orders/:id/events` in `workers/api/src/routes/driver.ts` to record entries in `ledger_entries` and update `orders.total_fare_paise`.
- **Affected Layers:** Backend (`workers/api`), Database (`orders`, `ledger_entries`).
- **Dependencies:** None.
- **Acceptance Criteria:** Added tolls and parking fees appear on the rider's final bill breakdown.
- **Required Tests:** Unit test verifying toll addition updates total fare and ledger.

---

### FIND-005: Universal Backdoor OTP `1234` in Production Trip Verification Handler

- **Category:** Security or privacy risk
- **Relevant Role and Journey:** Driver / Rider — Journey 1 (Trip Start Verification)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** XS (< 1 hour)
- **Confidence:** High
- **Current Vahanly Behavior:** In `workers/api/src/routes/driver.ts#L151`, the trip verification handler checks:
  ```ts
  if (rows[0].start_otp !== body.otp && body.otp !== '1234') {
    return c.json({ success: false, error: 'invalid OTP' }, 400);
  }
  ```
  Any driver can start any trip at any time without customer consent by simply entering `1234`.
- **Expected Behavior:** Trip start must strictly validate against `orders.start_otp`. No testing backdoors should exist in production routes. Failed attempts must be limited to 3 before locking.
- **DriveU Evidence:** DriveU strictly validates customer verification PIN before unlocking the trip meter (`FEATURE_FUNCTIONALITY.md` §5.3).
- **Vahanly Evidence:** `workers/api/src/routes/driver.ts#L151`.
- **Search Scope:** Scoped to `workers/api/src/routes/driver.ts`.
- **User/Business Impact:** Severe security and liability risk. A rogue driver can accept a trip, enter `1234`, start the trip without meeting the rider, drive around (or idle), and complete the trip to fraudulently extract fares.
- **Failure Scenario:** Driver assigned to a booking in Salt Lake enters `1234` while still at home. The rider's card/wallet is charged for an unauthorized journey.
- **Root Cause:** Hardcoded developer testing bypass committed to the codebase.
- **Recommended Solution:** Remove `&& body.otp !== '1234'` from `workers/api/src/routes/driver.ts`. Enforce 3-attempt lockout.
- **Affected Layers:** Backend (`workers/api`).
- **Dependencies:** None.
- **Acceptance Criteria:** Submitting `1234` fails with `400 Invalid OTP` unless `1234` happens to be the random OTP assigned by the system.
- **Required Tests:** Automated negative test verifying rejection of `1234`.

---

### FIND-006: Hardcoded SMS OTP `123456` in Auth Routes Without SMS Gateway Integration

- **Category:** Security or privacy risk
- **Relevant Role and Journey:** All Roles — Authentication
- **Priority:** **P0** (Launch Blocker)
- **Effort:** M (2 days)
- **Confidence:** High
- **Current Vahanly Behavior:** In `workers/api/src/routes/auth.ts#L221,L236,L283,L296`:
  - `POST /api/v1/driver/auth/send-otp` sets `otp = '123456'`.
  - `POST /api/v1/driver/auth/verify-otp` allows login if `body.otp === '123456'`.
  - `POST /api/v1/rider/auth/send-otp` caches `'123456'`.
  - `POST /api/v1/rider/auth/verify-otp` allows login if `body.otp === '123456'`.
  There is no integration with an Indian SMS gateway (e.g. Fast2SMS, Gupshup, Exotel, Twilio).
- **Expected Behavior:** System must generate a cryptographically random 6-digit OTP, dispatch it via a licensed DLT-registered SMS provider in India, and verify it against an expiring Redis/DO cache.
- **DriveU Evidence:** DriveU uses carrier SMS verification and Firebase Phone Auth (`DEEP_DIVE_REPORT.md` §2).
- **Vahanly Evidence:** `workers/api/src/routes/auth.ts#L221,L236,L283,L296`.
- **Search Scope:** `workers/api/src/routes/auth.ts`.
- **User/Business Impact:** Complete account takeover vulnerability. Anyone who knows any customer's or driver's phone number can log into their account by simply typing `123456`.
- **Failure Scenario:** Attacker inputs the phone number of a high-balance rider, enters `123456`, gains access to their saved credit cards, home address, and booking history.
- **Root Cause:** Placeholder implementation for offline testing.
- **Recommended Solution:** Integrate Firebase Phone Auth verification or an Indian SMS provider (DLT approved). Remove all hardcoded `'123456'` conditionals.
- **Affected Layers:** Backend (`workers/api`), Integrations.
- **Dependencies:** SMS provider API key and DLT template registration.
- **Acceptance Criteria:** Only a genuinely dispatched random OTP can authenticate the phone number.
- **Required Tests:** Negative test ensuring static codes fail authentication.

---

### FIND-007: Dispatch Screen Polling Desynchronization (`EN_ROUTE_TO_PICKUP` vs `ASSIGNED`)

- **Category:** Cross-role workflow gap
- **Relevant Role and Journey:** Customer (Rider) — Journey 1 (Dispatch Waiting)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** S (0.5 days)
- **Confidence:** High
- **Current Vahanly Behavior:** In `rider-app/app/(app)/dispatch/page.tsx#L218`, the polling loop checks:
  ```ts
  if (res.order.status === "EN_ROUTE_TO_PICKUP") {
    router.replace("/trip/live");
  }
  ```
  However, `workers/api/src/routes/orders.ts` and `workers/api/src/queue.ts#L37` only use the status `'ASSIGNED'`. They never set `'EN_ROUTE_TO_PICKUP'`. As a result, if the rider's WebSocket connection blips or disconnects, the HTTP polling fallback **never transitions the rider to the live trip**, leaving them permanently stuck watching the 60-second radar animation until it times out.
- **Expected Behavior:** Status values must be standardized across the domain model. Either the backend must transition to `EN_ROUTE_TO_PICKUP` upon driver acceptance, or the dispatch poll must recognize `ASSIGNED`.
- **DriveU Evidence:** DriveU transitions driver to `reserved` / `on-duty` and synchronizes customer app immediately (`DEEP_DIVE_REPORT.md` §2).
- **Vahanly Evidence:** 
  - `rider-app/app/(app)/dispatch/page.tsx#L218`
  - `workers/api/src/queue.ts#L37`
  - `workers/api/src/routes/orders.ts#L206`
- **Search Scope:** Scoped search for status strings in `rider-app` and `workers/api`.
- **User/Business Impact:** Severe UX breakdown. Riders who experience any mobile network packet loss while waiting for a driver are told "No driver found", even though a driver was matched and is driving toward them.
- **Failure Scenario:** Rider on a cellular connection in New Town loses WebSocket for 2 seconds. The radar keeps spinning for 60 seconds, then says "No drivers available". Meanwhile, the driver arrives at their house.
- **Root Cause:** Divergence in domain state enums between the frontend and the Cloudflare Worker.
- **Recommended Solution:** Unify order status enums across `rider-app`, `client-app`, and `workers/api`. Update polling check to accept both `ASSIGNED` and `EN_ROUTE_TO_PICKUP`.
- **Affected Layers:** Frontend (`rider-app`), Backend (`workers/api`).
- **Dependencies:** None.
- **Acceptance Criteria:** Polling immediately forwards the rider to `/trip/live` when order status is `ASSIGNED`.
- **Required Tests:** End-to-end dispatch poll simulation test without active WebSocket.

---

### FIND-008: Missing Object-Level Access Control on Order Cancellation Endpoint

- **Category:** Security or privacy risk
- **Relevant Role and Journey:** Customer (Rider) — Journey 5 (Trip Cancellation)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** XS (< 1 hour)
- **Confidence:** High
- **Current Vahanly Behavior:** In `workers/api/src/routes/orders.ts#L245`:
  ```ts
  orders.delete('/api/v1/rider/orders/:orderId/cancel', async (c) => {
    const orderId = c.req.param('orderId');
    // ...
    const rows = await sql`
      UPDATE orders
      SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'RIDER'
      WHERE id = ${orderId}::uuid
      RETURNING id, driver_id, city_prefix
    `;
  ```
  The query does **not** check `WHERE customer_id = user.user_id`. Any user (or even an unauthenticated user if JWT extraction fails) can cancel any trip in the system simply by supplying the order UUID.
- **Expected Behavior:** Must enforce object ownership: `WHERE id = ${orderId}::uuid AND customer_id = ${user.user_id}::uuid`.
- **DriveU Evidence:** Documented API passes `driver_id` and device credentials to restrict actions to authorized callers.
- **Vahanly Evidence:** `workers/api/src/routes/orders.ts#L245-L257`.
- **Search Scope:** `workers/api/src/routes/orders.ts`.
- **User/Business Impact:** Malicious disruption of platform operations. An attacker can scrape or guess active UUIDs and cancel active rides across the city.
- **Failure Scenario:** Attacker calls `DELETE /api/v1/rider/orders/<uuid>/cancel` on random IDs, canceling trips that are currently in-transit.
- **Root Cause:** Missing authorization constraint in the SQL update statement.
- **Recommended Solution:** Require active `user` claim and append `AND customer_id = ${user.user_id}::uuid` to the query.
- **Affected Layers:** Backend (`workers/api`).
- **Dependencies:** None.
- **Acceptance Criteria:** Attempting to cancel another user's order returns `403 Forbidden` or `404 Not Found`.
- **Required Tests:** Automated authorization test verifying cross-account cancellation rejection.

---

### FIND-009: Unauthenticated Spoofable `X-Admin-Role` Header in Operations Portal

- **Category:** Security or privacy risk
- **Relevant Role and Journey:** Admin & Operations — Journey 9 (Admin Intervention)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** S (1 day)
- **Confidence:** High
- **Current Vahanly Behavior:** In `frontend/src/admin/pages/DriverOnboardingQueue.tsx#L169,L181,L199`, administrative requests are authorized using an unauthenticated client HTTP header:
  ```ts
  const role = localStorage.getItem('admin_role') || 'ADMIN';
  const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/onboarding`, {
    headers: { 'X-Admin-Role': role },
  });
  ```
  Anyone can open the browser console, set `localStorage.setItem('admin_role', 'SUPER_ADMIN')`, and invoke sensitive endpoints.
- **Expected Behavior:** Administrative authorization must be enforced via cryptographically signed `HttpOnly` session cookies or verified JWT Bearer tokens validated against the `admin_users` table in PostgreSQL.
- **DriveU Evidence:** DriveU restricts ops controls to corporate VPN and back-office credentials.
- **Vahanly Evidence:** `frontend/src/admin/pages/DriverOnboardingQueue.tsx#L167-L200`.
- **Search Scope:** `frontend/src/admin/`.
- **User/Business Impact:** Critical privilege escalation. Any public user who visits the admin portal domain can bypass role restrictions.
- **Failure Scenario:** Unvetted driver opens admin site, sets `X-Admin-Role: SUPER_ADMIN`, and approves their own pending KYC documents.
- **Root Cause:** Legacy mock header from early frontend prototyping was never upgraded to cryptographic session validation.
- **Recommended Solution:** Remove all client-sent `X-Admin-Role` headers. Enforce `dfu_admin_session` cookie verification in `workers/api`.
- **Affected Layers:** Frontend (`frontend`), Backend (`workers/api`).
- **Dependencies:** Admin JWT middleware.
- **Acceptance Criteria:** Requests with arbitrary `X-Admin-Role` headers without valid session cookies return `401 Unauthorized`.
- **Required Tests:** Security penetration test testing admin privilege escalation without cookies.

---

### FIND-010: Hardcoded Fallback Customer UUID in Edge Order Creation Route

- **Category:** Security / Architecture Risk
- **Relevant Role and Journey:** Customer (Rider) — Journey 1 (Order Creation)
- **Priority:** **P0** (Launch Blocker)
- **Effort:** XS (< 1 hour)
- **Confidence:** High
- **Current Vahanly Behavior:** In `workers/api/src/routes/orders.ts#L89`:
  ```ts
  async function handleCreateOrder(c: any) {
    const user = c.get('user') as AuthClaims | undefined;
    const customerId = user?.user_id || 'c81d4e2e-bcf2-11e6-869b-7df243852131';
  ```
  If an unauthenticated request reaches `/api/v1/orders`, instead of returning `401 Unauthorized`, it silently creates an order assigned to a hardcoded fallback UUID (`c81d4e2e-bcf2-11e6-869b-7df243852131`).
- **Expected Behavior:** Unauthenticated order creation must immediately return `401 Unauthorized`.
- **DriveU Evidence:** Unauthenticated booking requests are rejected immediately.
- **Vahanly Evidence:** `workers/api/src/routes/orders.ts#L89`.
- **Search Scope:** `workers/api/src/routes/orders.ts`.
- **User/Business Impact:** Anonymous users can flood the platform with phantom orders, consuming driver dispatch capacity and incurring route computing costs.
- **Failure Scenario:** A bot script sends 1,000 requests to `POST /api/v1/orders`. The edge API accepts them all under the fake customer ID, locking up the Kolkata driver fleet.
- **Root Cause:** Developer test fallback left in production edge routing.
- **Recommended Solution:** Replace line 89 with: `if (!user?.user_id) return c.json({ error: 'unauthorized' }, 401);`.
- **Affected Layers:** Backend (`workers/api`).
- **Dependencies:** None.
- **Acceptance Criteria:** Anonymous POST to `/api/v1/orders` returns `401 Unauthorized`.
- **Required Tests:** Automated unauthorized order creation test.

---

### FIND-011: Disconnected Driver Onboarding Pipeline & KYC Document Review API

- **Category:** Operational readiness gap
- **Relevant Role and Journey:** Driver Partner & Admin — Journey 4 (Driver Onboarding)
- **Priority:** **P1** (Required for Release)
- **Effort:** L (3–4 days)
- **Confidence:** High
- **Current Vahanly Behavior:** `client-app` provides an onboarding flow (`src/app/driver-onboarding/page.tsx`) capturing Aadhaar, PAN, and DL photos. However, `workers/api` has no document upload endpoint (`/api/v1/driver/documents` or multipart file handler to R2). Similarly, `frontend/src/admin/pages/DriverOnboardingQueue.tsx` calls `GET /api/v1/admin/drivers/onboarding` and `POST /api/v1/admin/drivers/:id/onboarding-stage/:stage`, neither of which exists in `workers/api`.
- **Expected Behavior:** Drivers must upload KYC documents directly to Cloudflare R2 via signed upload URLs. Admin control room must list pending applicants, display document thumbnails from R2, and allow approving or rejecting applicants with recorded audit reasons.
- **DriveU Evidence:** `FEATURE_FUNCTIONALITY.md` §1 & §5.1: DriveU supports complete KYC document upload (`MyDocumentsActivity`, `AadharDocActivity`, `PanCardDocActivity`, `DrivingLicenseDocActivity`) and DigiLocker integration.
- **Vahanly Evidence:** 
  - `client-app/src/app/driver-onboarding/page.tsx`
  - `frontend/src/admin/pages/DriverOnboardingQueue.tsx`
  - `workers/api/src/routes/admin.ts` (missing onboarding routes)
- **Search Scope:** Scoped search for `/onboarding` across `workers/api`.
- **User/Business Impact:** New drivers cannot onboard or be legally approved to drive. Platform cannot recruit fleet supply.
- **Failure Scenario:** Applicant uploads driver license photo. Upload fails with 404. Applicant abandons the app.
- **Root Cause:** Onboarding endpoints existed in Go (`internal/driver/delivery/http/onboarding_handler.go`), but were not ported to TypeScript in `workers/api`.
- **Recommended Solution:** Implement R2 document upload in `workers/api/src/routes/files.ts` and port the admin onboarding queue endpoints in `workers/api/src/routes/admin.ts`.
- **Affected Layers:** Backend (`workers/api`), Frontend (`client-app`, `frontend`), Storage (R2).
- **Dependencies:** R2 bucket binding (`vahnly-documents`).
- **Acceptance Criteria:** Driver uploads DL photo → Photo persists in R2 → Admin sees card in Kanban queue → Admin clicks Approve → Driver status becomes `is_verified=true`.
- **Required Tests:** End-to-end KYC upload and approval lifecycle integration test.

---

### FIND-012: Competitor Artifacts & Branding Leaks (`d4m@ybl`, `DriverforU`, `d4mCareOptIn`)

- **Category:** Product Polish / Legal Risk
- **Relevant Role and Journey:** All Users — Brand Identity
- **Priority:** **P1** (Required for Release)
- **Effort:** S (0.5 days)
- **Confidence:** High
- **Current Vahanly Behavior:** The codebase contains explicit competitor placeholder strings:
  1. `rider-app/app/(app)/trip/bill/page.tsx#L128`: UPI VPA is hardcoded as `pa=d4m@ybl&pn=DriverforU`.
  2. `rider-app/src/lib/api/orders.ts#L26`: Insurance field named `d4m_care_opted`.
  3. `client-app/src/app/driver/trip/live/TripInProgressPane.tsx#L100`: Reads `activeTrip?.d4m_care_opted ?? activeTrip?.d4mCareOptIn`.
- **Expected Behavior:** All client-facing strings, parameters, and VPAs must strictly use Vahanly branding (`vahanly@ybl`, `vahanly_care_opted`).
- **DriveU Evidence:** Not applicable (Competitor leakage from Drivers4Me).
- **Vahanly Evidence:**
  - `rider-app/app/(app)/trip/bill/page.tsx#L128`
  - `rider-app/src/lib/api/orders.ts#L26`
  - `client-app/src/app/driver/trip/live/TripInProgressPane.tsx#L100`
- **Search Scope:** Global grep for `d4m` across `rider-app`, `client-app`, and `frontend`.
- **User/Business Impact:** Severe brand confusion and potential trademark infringement / legal action from competitor Drivers4Me (D4M).
- **Failure Scenario:** Customer paying via UPI sees "Pay to DriverforU (d4m@ybl)" in their Google Pay / PhonePe app.
- **Root Cause:** Developer benchmarked against Drivers4Me during early prototyping and copied literal VPA/field names.
- **Recommended Solution:** Replace all occurrences of `d4m` with `vahanly` across all applications and database columns.
- **Affected Layers:** Frontend (`rider-app`, `client-app`), Database (migration column aliases).
- **Dependencies:** None.
- **Acceptance Criteria:** Zero occurrences of `d4m` or `DriverforU` in any client bundle or outgoing network packet.
- **Required Tests:** CI lint/grep check forbidding `d4m` in source files.

---

### FIND-013: Missing Driver Offer Expiry & Stale Order Auto-Reassignment in Cron

- **Category:** Architecture / Reliability Risk
- **Relevant Role and Journey:** Dispatch Domain — Journey 3 & 6 (Dispatch Recovery)
- **Priority:** **P1** (Required for Release)
- **Effort:** M (2 days)
- **Confidence:** High
- **Current Vahanly Behavior:** When a driver goes stale or disappears, `workers/cron/src/index.ts#L105` marks the driver `OFFLINE` in PostgreSQL. However, it **does not inspect active orders assigned to that driver**. If a driver phone dies while an order is in `ASSIGNED` or `CREATED`, the order is never released or re-queued. The customer waits indefinitely.
- **Expected Behavior:** When a driver is marked offline or an offer times out (15s), the order must be detached from the driver, returned to the dispatch queue, and routed to the next nearest candidate. If no candidates exist, it must enter a progressive retry schedule before timing out gracefully.
- **DriveU Evidence:** DriveU automatically re-dispatches unacknowledged bookings and notifies the customer (`FEATURE_FUNCTIONALITY.md` §5.3).
- **Vahanly Evidence:** `workers/cron/src/index.ts#L103-L113`.
- **Search Scope:** `workers/cron` and `workers/api/src/queue.ts`.
- **User/Business Impact:** Ghost bookings that strand customers on the street when drivers lose connectivity.
- **Failure Scenario:** Driver accepts order, battery dies. Order stays assigned to the dead driver forever. Rider never gets picked up.
- **Root Cause:** Absence of state reconciler worker in the Cloudflare Worker cron jobs.
- **Recommended Solution:** Add order state reconciliation to `workers/cron/src/index.ts`: find `orders WHERE status = 'ASSIGNED' AND driver_id IN (SELECT id FROM drivers WHERE current_state = 'OFFLINE')`, reset to `CREATED`, and emit `order.created` to `EVENTS`.
- **Affected Layers:** Background Worker (`workers/cron`), Database (`orders`).
- **Dependencies:** `LockDO`.
- **Acceptance Criteria:** Killing a driver's network during an assigned trip automatically re-queues the order within 60 seconds.
- **Required Tests:** Disconnection recovery integration test.

---

### FIND-014: Scheduled Booking Lead-Time Dispatch Unconnected in Edge Backend

- **Category:** Architecture / Parity Gap
- **Relevant Role and Journey:** Customer (Rider) — Journey 2 (Scheduled Bookings)
- **Priority:** **P1** (Required for Release)
- **Effort:** M (2 days)
- **Confidence:** High
- **Current Vahanly Behavior:** In `workers/api/src/routes/orders.ts#L87`, order creation treats all requests as immediate on-demand trips. `scheduled_at` from `rider-app` is ignored. The order is inserted with `status='CREATED'` and dispatched immediately, even if the user requested a pickup 3 days in the future.
- **Expected Behavior:** If `scheduled_at` is provided and is > 30 minutes in the future, the order must be persisted with `status = 'SCHEDULED'`. `workers/cron` must sweep upcoming scheduled trips 15 minutes prior to pickup and trigger dispatch.
- **DriveU Evidence:** DriveU treats scheduled bookings as first-class reservations (`driver/future-bookings/v2/`, `driver/reserve-booking/`).
- **Vahanly Evidence:** 
  - `rider-app/src/components/booking/BookingSheet.tsx` (supports scheduling)
  - `workers/api/src/routes/orders.ts#L87-L143` (ignores `scheduled_at`)
  - `workers/cron/src/index.ts#L73-L100` (contains sweep query that is never populated)
- **Search Scope:** `workers/api/src/routes/orders.ts`.
- **User/Business Impact:** Core business model failure. In the driver-on-hire market, >40% of trips are booked in advance for airport drops or daily office commutes. Immediately dispatching drivers for future trips leads to instant cancellations.
- **Failure Scenario:** Customer schedules a driver for tomorrow morning at 6:00 AM. System dispatches a driver tonight at 10:00 PM. Driver arrives at 10:15 PM and cancels when rider explains the trip is for tomorrow.
- **Root Cause:** Field dropped in `orders.ts` handler during migration.
- **Recommended Solution:** Parse `scheduled_at` in `workers/api/src/routes/orders.ts`. Set `status = 'SCHEDULED'` when `scheduled_at > NOW() + INTERVAL '20 minutes'`.
- **Affected Layers:** Backend (`workers/api`, `workers/cron`), Database (`orders`).
- **Dependencies:** None.
- **Acceptance Criteria:** A trip scheduled for tomorrow is saved as `SCHEDULED` and is only dispatched 15 minutes before the pickup time.
- **Required Tests:** Scheduled dispatch cron trigger unit test.

---

### FIND-015: Hardcoded Driver Stats & Mock Earnings Endpoints in Edge API

- **Category:** Vahanly implementation defect
- **Relevant Role and Journey:** Driver Partner — Earnings & Performance
- **Priority:** **P1** (Required for Release)
- **Effort:** S (1 day)
- **Confidence:** High
- **Current Vahanly Behavior:** In `workers/api/src/routes/driver.ts#L104-L116` and `L221-L228`:
  ```ts
  driver.get('/api/v1/driver/stats', async (c) => {
    return c.json({
      rating: 4.88,
      acceptance_rate: 0.94,
      cancellation_rate: 0.02,
      today_earnings_paise: 245000,
      today_trips_count: 8,
      online_minutes_today: 340,
    });
  });
  // ...
  driver.get('/api/v1/driver/earnings', async (c) => {
    return c.json({
      total_earnings_paise: 4500000,
      withdrawable_paise: 3800000,
      trips_count: 142,
      this_week_earnings_paise: 1250000,
    });
  });
  ```
  Every driver in the system sees the exact same fake earnings (₹45,000 total, ₹38,000 withdrawable, 142 trips) regardless of their actual trip history.
- **Expected Behavior:** Stats and earnings must be aggregated dynamically from `ledger_entries` and `orders` where `driver_id = user.user_id`.
- **DriveU Evidence:** DriveU provides real-time per-trip and daily earnings history (`driver/history/forday/`, `wallet/txn-log/driver/`).
- **Vahanly Evidence:** `workers/api/src/routes/driver.ts#L104-L116,L221-L228`.
- **Search Scope:** `workers/api/src/routes/driver.ts`.
- **User/Business Impact:** Severe financial accounting and driver trust issue. A driver who completes 0 trips sees ₹38,000 withdrawable and requests a payout.
- **Failure Scenario:** New driver registers, opens Earnings tab, sees ₹38,000, taps "Request Payout", and creates a fraudulent payout request in the database.
- **Root Cause:** Mock handlers committed to unblock frontend styling.
- **Recommended Solution:** Replace static objects with real SQL queries summing completed orders and ledger balances for `user.user_id`.
- **Affected Layers:** Backend (`workers/api`), Database (`orders`, `ledger_entries`).
- **Dependencies:** None.
- **Acceptance Criteria:** Driver earnings accurately reflect the sum of their completed trips minus platform commission.
- **Required Tests:** Earnings calculation integration test with multiple driver fixtures.

---

### FIND-016: Missing Driver Wallet Debit, Ledger Balance, and Payout Settlement Rails

- **Category:** Financial Correctness
- **Relevant Role and Journey:** Driver Partner — Financial Operations
- **Priority:** **P1** (Required for Release)
- **Effort:** L (3–4 days)
- **Confidence:** High
- **Current Vahanly Behavior:** Drivers can request a payout (`POST /api/v1/driver/payouts/request`), inserting a row with `status='REQUESTED'` into `driver_payouts`. However, there is no real banking/UPI payout rail (e.g. RazorpayX, Cashfree Payouts, Decentro). In `workers/cron/src/index.ts#L115`, if sandbox auto-settle is enabled, it blindly marks the payout `COMPLETED` after 1 minute without sending funds. Furthermore, when cash is collected, the platform commission is never debited from the driver's wallet.
- **Expected Behavior:** Payout requests must validate available balance in `ledger_entries`, verify bank/UPI KYC details, and disburse funds via a banking API. Platform fee deductions must occur automatically upon cash trip completion.
- **DriveU Evidence:** DriveU features instant payout via Juspay/Razorpay rails and automatically deducts subscription/platform fees (`DEEP_DIVE_REPORT.md` §5).
- **Vahanly Evidence:** 
  - `workers/api/src/routes/driver.ts#L254`
  - `workers/cron/src/index.ts#L115-L123`
- **Search Scope:** `workers/api` and `workers/cron`.
- **User/Business Impact:** Inability to legally and reliably disburse earnings to driver partners.
- **Failure Scenario:** Platform launches; drivers cannot withdraw money to their bank accounts; drivers strike and leave the platform.
- **Root Cause:** Banking payout API integration not yet implemented.
- **Recommended Solution:** Integrate RazorpayX or Cashfree Payouts SDK in `workers/cron` or a dedicated payout workflow (`PayoutBatchWorkflow`).
- **Affected Layers:** Backend (`workers/api`, `workers/cron`), Database (`driver_payouts`).
- **Dependencies:** Corporate bank account and payout gateway merchant setup.
- **Acceptance Criteria:** Driver initiates withdrawal → Funds transfer to driver's bank account via IMPS/UPI within 60 seconds → Ledger balance decreases accordingly.
- **Required Tests:** Payout lifecycle test with mock banking webhooks.

---

### FIND-017: 80% of Admin Operations Dashboards 404 Against Cloudflare Worker API

- **Category:** Operational readiness gap
- **Relevant Role and Journey:** Admin / Operations — Control Room & Management
- **Priority:** **P1** (Required for Release)
- **Effort:** L (4–5 days)
- **Confidence:** High
- **Current Vahanly Behavior:** The admin frontend (`frontend/src/admin/adminRoutes.tsx`) registers over 30 management dashboards:
  `RidersList`, `RiderDetail`, `DriversList`, `DriverDetail`, `DriverOnboardingQueue`, `VehiclesList`, `DispatchDashboard`, `SupportDashboard`, `SafetyDashboard`, `PromotionsDashboard`, `CorporateDashboard`, `CarIssuesDashboard`.
  However, `workers/api/src/routes/admin.ts` implements only **7 basic endpoints**:
  1. `GET /api/v1/admin/orders`
  2. `GET /api/v1/admin/orders/:id`
  3. `POST /api/v1/admin/orders/cancel`
  4. `GET /api/v1/admin/ledger`
  5. `GET /api/v1/admin/pricing/fares`
  6. `POST /api/v1/admin/pricing/freeze`
  7. `POST /api/v1/admin/drivers/override`
  Every other dashboard screen in the operations portal fails with 404 network errors upon navigation.
- **Expected Behavior:** `workers/api` must provide the operational REST endpoints required to inspect riders, drivers, support tickets, safety incidents, and promotions.
- **DriveU Evidence:** DriveU ops maintains comprehensive back-office controls for driver KYC, dispute resolution, and fleet configuration.
- **Vahanly Evidence:**
  - `frontend/src/admin/adminRoutes.tsx`
  - `workers/api/src/routes/admin.ts`
- **Search Scope:** Complete route comparison between `frontend/src/admin/` and `workers/api/src/routes/admin.ts`.
- **User/Business Impact:** Operations team is completely blind and cannot resolve customer complaints, unblock stuck drivers, inspect vehicle compliance, or audit support tickets.
- **Failure Scenario:** A customer reports an emergency or lost property. Operations team logs into admin dashboard, clicks "Support Tickets", and sees a blank page with 404 console errors.
- **Root Cause:** The Go backend had comprehensive admin handlers (`internal/admin/delivery/http/*`), but only the control room radar endpoints were ported to Cloudflare Workers.
- **Recommended Solution:** Port the remaining administrative REST endpoints from `internal/admin/delivery/http/` into `workers/api/src/routes/admin.ts`.
- **Affected Layers:** Backend (`workers/api`), Frontend (`frontend`).
- **Dependencies:** None.
- **Acceptance Criteria:** All core admin tabs (Drivers, Riders, Disputes, KYC) load live data without HTTP 404 errors.
- **Required Tests:** Contract test suite testing all admin route responses against DB seed data.

---

### FIND-018: Zero Automated Test Coverage in Edge Backend (`workers/api` & `workers/cron`)

- **Category:** Quality & Reliability Risk
- **Relevant Role and Journey:** DevOps / QA — All Journeys
- **Priority:** **P1** (Required for Release)
- **Effort:** M (2–3 days)
- **Confidence:** High
- **Current Vahanly Behavior:** An exhaustive search of `workers/api` and `workers/cron` reveals **zero test files** (`.test.ts` or `.spec.ts`). There are no unit tests, no Vitest/Miniflare tests, and no integration tests verifying the edge API gateway, Durable Objects, or cron sweeps.
- **Expected Behavior:** All critical route handlers, Durable Object state transitions, and cron sweep tasks must be covered by automated Miniflare tests run in CI prior to deployment.
- **DriveU Evidence:** Not applicable (DriveU internal QA).
- **Vahanly Evidence:** Confirmed zero test files in `workers/` directory.
- **Search Scope:** `C:\workspace\Driver\workers\`.
- **User/Business Impact:** Extreme regression risk. Any refactor or dependency upgrade can silently break core matching, payments, or authentication without detection until reported by live users.
- **Failure Scenario:** A developer edits `CityDispatchDO.ts` to adjust H3 search radiuses, introducing a syntax bug in SQLite. The deployment succeeds, but all matching in Kolkata crashes immediately.
- **Root Cause:** Migration to Cloudflare Workers was pushed rapidly without porting the 80+ Go tests in `internal/` into TypeScript.
- **Recommended Solution:** Establish a Vitest + `@cloudflare/vitest-pool-workers` test suite in `workers/api`, writing test suites for auth, orders, dispatch, and payments.
- **Affected Layers:** Backend (`workers/api`, `workers/cron`), CI/CD (`.github/workflows`).
- **Dependencies:** Vitest workers pool.
- **Acceptance Criteria:** `npm run test` in `workers/api` executes and passes clean with >75% branch coverage on core routing.
- **Required Tests:** Miniflare test harness for all endpoints.
