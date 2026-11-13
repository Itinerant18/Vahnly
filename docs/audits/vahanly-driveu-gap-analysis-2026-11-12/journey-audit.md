# End-to-End User Journey Audit

- **Date:** 2026-11-12
- **Audit Target:** Canonical Cross-Role User Journeys in Vahanly
- **Auditor:** QA Lead & Senior Mobile Product Architect

---

## 1. Journey Audit Overview

This document traces the 10 critical end-to-end user journeys across the user interface, client state management, network client, API gateway, persistence layer, background workers, and real-time event streams.

### Verdict Classifications
- **Verified Complete:** Path works end-to-end with server persistence and verified state transitions.
- **Broken / Blocked:** Contains an unhandled exception, syntax error, missing endpoint, or broken state link that halts the journey.
- **Partially Functional / Simulated:** Visual journey completes but relies on mock delays, client-side fallbacks, or lacks backend authority.

---

## 2. Journey Traces

### Journey 1: New Customer Onboarding → Booking → Assignment → Trip → Payment → Receipt

```
[Phone Entry] ──> [Firebase Verify] ──> [Home Map] ──> [BookingSheet]
                                                             │
  CRASH: TypeError in BookingSheet.tsx (res.order undefined) ◄───┘ (FIND-001)
```

1. **Authentication:**
   - **Entry Point:** `rider-app/app/(auth)/login/page.tsx` → `PhoneVerifyScreen.tsx`.
   - **Code Path:** User enters 10-digit phone number. `client.ts` calls `POST /api/v1/auth/firebase/verify` with Firebase ID token (or testing fallback `POST /api/v1/rider/auth/send-otp` and `verify-otp`).
   - **Persisted State:** Inserts new row in `riders` table (`id`, `name`, `phone`, `is_active=true`) in Neon PostgreSQL.
   - **Authorization:** Server signs JWT with claims `{ user_id, role: 'RIDER', phone_verified: true }`. Stored in localStorage `dfu_rider_token`.
   - **Verdict:** Implemented, runtime unverified (passes static check; relies on backdoor `123456` if Firebase mock).

2. **Service Discovery & Address Search:**
   - **Entry Point:** `rider-app/app/(app)/home/page.tsx` → `PickupDropInput.tsx`.
   - **Code Path:** Debounced geocoding query to `/api/v1/maps/autocomplete` via OpenStreetMap / Photon geocoder.
   - **Persisted State:** None (in-memory state in `useBookingStore`).
   - **Verdict:** Implemented and functional.

3. **Booking Submission & Quote:**
   - **Entry Point:** `rider-app/src/components/booking/BookingSheet.tsx#L538` (`handleConfirmBooking`).
   - **Code Path:** Invokes `bookDriver()` in `rider-app/src/lib/store/bookingStore.ts`.
   - **Request:** `POST /api/v1/orders` with idempotency key header.
   - **Backend Execution:** `workers/api/src/routes/orders.ts#L87` calculates route and fare, inserts row into `orders` (`status='CREATED'`), and queues `order.created` event.
   - **API Response:** `{ success: true, order_id: "...", status: "SEARCHING", start_otp: "...", share_token: "..." }`.
   - **CRITICAL BREAKAGE (FIND-001):**
     - `bookingStore.ts#L310` returns `{ order: res.order, otp: res.otp }`.
     - Because the backend returns `{ order_id }` and **not** `{ order: Order }`, `res.order` is `undefined`.
     - In `BookingSheet.tsx#L539`: `const { order } = await bookDriver(); router.push('/dispatch?orderId=' + order.id);`
     - **Result:** Throws uncaught `TypeError: Cannot read properties of undefined (reading 'id')`. The client displays a generic error toast "Booking failed", and the user is NEVER transitioned to the dispatch screen.
   - **Verdict:** **BLOCKED (P0)**.

4. **Dispatch Matching & Assignment:**
   - **Code Path:** `workers/api/src/queue.ts#L18` processes `order.created` message batch.
   - **Durable Object Match:** `CityDispatchDO.matchOrder()` scans H3 rings (k=1..3) in SQLite for `ONLINE_AVAILABLE` drivers.
   - **CRITICAL BREAKAGE (FIND-002):**
     - When a driver is found, `CityDispatchDO` immediately executes:
       `UPDATE driver_index SET status = 'ASSIGNED' WHERE driver_id = ?;`
     - `queue.ts` updates PostgreSQL order status to `'ASSIGNED'`.
     - **No Offer Issued:** No offer is sent to the driver's phone. `client-app` polls `GET /api/v1/driver/offer`, which **does not exist** on `workers/api` (returns 404). The driver never receives an incoming offer modal.
   - **Verdict:** **BROKEN (P0)**.

5. **Trip Execution & OTP Verification:**
   - **Entry Point:** `client-app/src/app/driver/trip/live/ArrivedVerificationPane.tsx`.
   - **Code Path:** Driver inputs 4-digit OTP, starting odometer, fuel percentage. Calls `POST /api/v1/driver/orders/:id/verify-otp`.
   - **Backend Execution:** `workers/api/src/routes/driver.ts#L141`.
   - **SECURITY BREAKAGE (FIND-005):**
     - Line 151: `if (rows[0].start_otp !== body.otp && body.otp !== '1234') { return 400; }`
     - The backdoor `1234` permits arbitrary trip starts without rider consent.
     - Backend completely ignores `startOdometer`, `startFuel`, and `carPlate` verification sent by the client.
   - **Verdict:** Present but defective (Security Risk).

6. **Payment & Billing:**
   - **Entry Point:** `rider-app/app/(app)/trip/bill/page.tsx#L115`.
   - **Code Path:** Rider selects UPI, Wallet, or Card and clicks "Pay".
   - **CRITICAL BREAKAGE (FIND-003):**
     - UPI: Launches hardcoded dummy UPI URL `upi://pay?pa=d4m@ybl&pn=DriverforU...` and sets `setTimeout(() => setPaid(true), 800)`.
     - Wallet: Sets `setTimeout(() => setPaid(true), 1200)`. Server balance is never checked or debited.
     - Card: Sets `setPaid(true)` instantly.
     - **Result:** No payment intent created, no webhook received, no ledger transaction recorded. Payment success is 100% simulated on the client.
   - **Verdict:** **SIMULATED / BLOCKED (P0)**.

---

### Journey 2: Scheduled Booking → Lead-Time Dispatch → Assignment → Completion

1. **Rider Scheduling Entry:**
   - Rider selects "Later" in `BookingSheet.tsx`, picks date and time.
   - In `rider-app/src/lib/store/bookingStore.ts`, `scheduled_at` is appended to `CreateOrderRequest`.
2. **Backend Storage:**
   - `workers/api/src/routes/orders.ts#L87` ignores `scheduled_at` and immediately executes immediate dispatch (`INSERT INTO orders (status='CREATED')`).
   - Migration `000113_create_scheduled_dispatch_queue.up.sql` created `scheduled_dispatch_queue`, but `workers/api` never inserts into it.
3. **Cron Sweep:**
   - `workers/cron/src/index.ts#L82` contains a query looking for `orders WHERE status = 'SCHEDULED'`, but because `workers/api` never writes `status='SCHEDULED'`, the cron sweep never finds any scheduled trips.
4. **Verdict:** **BROKEN (P1)** — Scheduled bookings are immediately dispatched as instant on-demand orders.

---

### Journey 3: No Driver Available → Customer Timeout → Recovery

1. **Search Initiation:**
   - Rider reaches `rider-app/app/(app)/dispatch/page.tsx`. Radar animation displays 60-second countdown.
2. **Queue Execution:**
   - `workers/api/src/queue.ts#L26` calls `CityDispatchDO.matchOrder()`.
   - If no drivers are within 3 H3 rings, `matchResult.matched` is `false`.
3. **Dead End:**
   - If no driver matches, `queue.ts` does **nothing**. It does not emit a failure event, does not schedule a retry delay, and does not update order status in PostgreSQL.
   - Order remains indefinitely stuck in `status='CREATED'`.
4. **Client-Side Timeout:**
   - After 60 seconds, `dispatch/page.tsx` hits client-side `SEARCH_TIMEOUT_MS`.
   - The client transitions to `TIMEOUT` state and displays "Drivers are busy in your area".
   - If the rider taps "Try Again", it starts a new search poll against the same stuck order without re-triggering dispatch.
5. **Verdict:** **PARTIALLY FUNCTIONAL WITH STUCK BACKEND STATE (P1)**.

---

### Journey 4: Driver Onboarding → Approval → Availability → First Trip

1. **Driver Registration:**
   - Driver enters phone on `client-app/src/app/driver/login/page.tsx`.
   - Authenticates via `workers/api/src/routes/auth.ts#L208` using hardcoded OTP `123456`.
2. **Document Upload:**
   - Driver navigates to `client-app/src/app/driver-onboarding/page.tsx`.
   - UI prompts for Aadhaar, PAN, DL, and vehicle registration photos.
   - Form submission calls `uploadDriverDocument()` in `client-app/src/api/client.ts`.
3. **API Missing:**
   - In `workers/api`, there is no route for document upload or KYC submission (`/api/v1/driver/documents` or `/api/v1/driver/onboarding`).
   - The upload fails with 404.
4. **Admin Approval Disconnect:**
   - Admin opens `frontend/src/admin/pages/DriverOnboardingQueue.tsx`.
   - Calls `GET /api/v1/admin/drivers/onboarding`.
   - Route does not exist on `workers/api` (returns 404). Admin queue is empty.
   - Driver remains in `is_verified=false` permanently.
5. **Verdict:** **BLOCKED (P1)**.

---

### Journey 5: Customer Cancellation at Different Booking Stages

1. **Cancellation during SEARCHING:**
   - Rider taps "Cancel Search" in `dispatch/page.tsx`.
   - Calls `DELETE /api/v1/rider/orders/:orderId/cancel`.
   - Backend `workers/api/src/routes/orders.ts#L245` updates order to `CANCELLED` and sends `order.cancelled` to `EVENTS` queue.
   - `queue.ts#L94` resets driver status to `ONLINE_AVAILABLE` in `CityDispatchDO`.
   - **SECURITY ISSUE (FIND-008):** Endpoint does not check `WHERE customer_id = user.user_id`. Any user can cancel any active order in the system by knowing its UUID.
2. **Cancellation after ASSIGNED:**
   - Rider opens cancel modal in `LiveTripView.tsx`.
   - UI shows estimated cancellation fee (₹30 en-route, ₹50 arrived).
   - Backend updates status to `CANCELLED` but **never calculates or assesses a cancellation charge** to the rider's wallet or payment card.
3. **Verdict:** Present but defective (Security & Financial Leakage).

---

### Journey 6: Driver Cancellation or Disappearance After Acceptance

1. **Driver Abandonment:**
   - In `client-app/src/app/driver/page.tsx`, driver clicks "Can't do this trip" / "Abandon".
   - Calls `abandonTrip()` (`/api/v1/driver/orders/:id/abandon`).
   - Endpoint **does not exist** in `workers/api` (404).
2. **Driver Disappearance (Loss of GPS/Network):**
   - Driver app dies or loses connectivity.
   - `workers/cron/src/index.ts#L105` runs minute sweep: `sweepStale(180)`.
   - `CityDispatchDO` sweeps drivers inactive for >3 minutes and marks them `OFFLINE` in PostgreSQL.
   - **MISSING RECOVERY (FIND-013):** The cron job marks the driver offline, but **does not reassign or cancel the active order** assigned to that driver! The rider remains waiting indefinitely for a driver whose phone is dead.
3. **Verdict:** **BROKEN (P1)**.

---

### Journey 7: Payment Failure, Duplicate Webhook, Delayed Confirmation

1. **Payment Initiation:**
   - Client does not initiate real gateway payments (see Journey 1).
2. **Webhook Endpoint:**
   - `POST /api/v1/payments/webhook` in `workers/api/src/routes/payments.ts#L17`.
   - Verifies HMAC-SHA256 signature using `timingSafeEqual()`.
   - Updates `orders.payment_status = 'PAID'`.
   - Inserts row in `ledger_entries`.
3. **Missing Idempotency in Webhook:**
   - If a webhook is retried by the payment gateway (Juspay / Razorpay), the endpoint executes:
     `INSERT INTO ledger_entries (entry_type, amount_paise, reference_id, description)...`
     without an `ON CONFLICT` or duplicate check. Retried webhooks create **duplicate ledger entries**, corrupting financial accounting.
4. **Verdict:** Present but defective (Financial Ledger Duplication).

---

### Journey 8: Network Interruption & Session Recovery During Booking

1. **WebSocket Drop:**
   - Rider experiences connectivity blip. `RiderStreamManager.ts` detects socket close.
   - Reconnection uses jittered exponential backoff (500ms to 8000ms).
   - Reconnect requires minting a new ticket via `POST /api/v1/ws/ticket` with JWT.
   - If ticket succeeds, socket reopens cleanly.
2. **App Cold Restart (Tab Kill):**
   - Rider re-opens app while trip is live.
   - `rider-app/app/(app)/home/page.tsx` checks `ordersApi.active()`.
   - Calls `GET /api/v1/rider/orders/active` (`workers/api/src/routes/orders.ts#L181`).
   - Backend queries PostgreSQL for `status IN ('CREATED', 'ASSIGNED', 'ARRIVED', 'IN_TRANSIT')`.
   - If active order exists, client updates `useTripStore` and redirects to `/trip/live`.
3. **Verdict:** Complete and verified (Resilient state recovery works well).

---

### Journey 9: Admin Intervention in a Stuck Booking

1. **Observation:**
   - Admin views stuck order in `frontend/src/admin/ControlRoomDashboard.tsx`.
2. **Manual Override / Cancel:**
   - Admin clicks "Cancel Trip" in `TripDetail.tsx`.
   - Calls `POST /api/v1/admin/orders/cancel` (`workers/api/src/routes/admin.ts#L70`).
   - Updates status to `CANCELLED`, emits `order.cancelled` to `EVENTS` queue.
3. **Manual Reassignment:**
   - Admin attempts to manually assign a different driver to the order.
   - `workers/api` lacks a manual assignment endpoint (`/api/v1/admin/orders/:id/assign`).
   - Admin is forced to cancel the trip entirely; cannot reassign.
4. **Verdict:** Partially implemented.

---

### Journey 10: Support Escalation or Safety Emergency (SOS)

1. **Rider SOS:**
   - Rider holds SOS button in `rider-app/src/components/trip/SOSModal.tsx`.
   - Calls `POST /api/v1/safety/sos` (Go gateway) or `POST /api/v1/driver/sos` (Workers).
2. **Broadcast:**
   - `workers/api/src/routes/driver.ts#L320` broadcasts JSON payload `{ type: 'sos.alert' }` to `OrderStreamDO` and `global-sos`.
   - Sends emergency dispatch alert.
3. **Support Tickets:**
   - Rider attempts to open support ticket in `rider-app/app/(app)/account/support/page.tsx`.
   - Calls `POST /api/v1/support/tickets`.
   - Endpoint **does not exist** on `workers/api` (404).
4. **Verdict:** Partially implemented (SOS broadcast works; support ticketing missing).
