# Feature Parity Matrix: DriveU vs. Vahanly

- **Date:** 2026-11-12
- **Audit Target:** DriveU Reference vs. Vahanly Implementation
- **Auditor:** Product Analyst & QA Lead

---

## 1. Matrix Overview

This matrix establishes an evidence-based comparison between the capabilities documented in the DriveU reverse-engineering artifacts (`DriveU_apk_for_rea`, `DriveUpartner_apk_for_rea`) and Vahanly's current implementation across `rider-app`, `client-app`, `frontend`, `workers/api`, `workers/cron`, and `database/migrations`.

### Implementation Status Key
- **Complete and verified:** Fully implemented across UI, API, DB, and verified working.
- **Implemented, runtime not verified:** Implemented across layers, static code verified, runtime unverified.
- **Partially implemented:** Implementation exists across some layers but is missing key linkages or transitions.
- **UI only:** Rendered in client UI but calls non-existent endpoints, stubs, or mock handlers.
- **Backend only:** Handled in database/worker API but has no corresponding user interface.
- **Mock or placeholder:** Implemented using hardcoded data, fake timers (`setTimeout`), or dummy text.
- **Missing after scoped inspection:** Searched across codebase and confirmed absent.
- **Present but defective:** Feature exists but contains breaking errors, syntax exceptions, or critical logic flaws.

---

## 2. Comprehensive Parity Table

| Feature / Journey | Role | DriveU Evidence | Vahanly Status | Vahanly Evidence | Gap Category | Priority | Confidence | Finding IDs |
|:---|:---:|:---|:---|:---|:---|:---:|:---:|:---|
| **Phone & OTP Login** | Rider | Documented via backend endpoint `driver/login/` with phone + OTP | Implemented, runtime not verified | `rider-app/src/lib/api/auth.ts`, `workers/api/src/routes/auth.ts` | Vahanly implementation defect | P0 | High | FIND-006 |
| **Test OTP Bypass (`123456`)** | Rider / Driver | Not present in DriveU; DriveU verifies real SMS / Firebase | Present but defective | `workers/api/src/routes/auth.ts#L221,L236,L283,L296` | Security or privacy risk | P0 | High | FIND-006 |
| **Driver Password Login** | Driver | `POST driver/login/` with mobile + passcode (`DEEP_DIVE_REPORT.md` §2) | Implemented, runtime not verified | `client-app/src/app/driver/login/page.tsx`, `workers/api/src/routes/auth.ts#L145` | Intentional difference requiring confirmation | P2 | High | — |
| **Driver Duty Gating (Health/Fraud)** | Driver | Native probes for battery ≥35%, net ≥50, mock GPS, fraud apps (`FEATURE_FUNCTIONALITY.md` §4) | UI only | `client-app/src/components/home/HomeOffline.tsx` (shows checks), but no native mock-location or fraud app scanner | Reference-product parity gap | P1 | High | FIND-020 |
| **Driver Duty Online/Offline Toggle** | Driver | `driver/check-in/`, `driver/check-out/` (`FEATURE_FUNCTIONALITY.md` §5.2) | Implemented, runtime not verified | `client-app/src/store/useDriverDutyStore.ts`, `workers/api/src/routes/driver.ts#L10` | Cross-role workflow gap | P1 | High | — |
| **Continuous GPS Telemetry Stream** | Driver | 4 background services pushing lat/lng (`FEATURE_FUNCTIONALITY.md` §2) | Implemented, runtime not verified | `client-app/src/services/telemetryStream.ts`, `workers/api/src/routes/driver.ts#L46` | Architecture or reliability risk | P1 | High | — |
| **Saved Vehicles / Garage** | Rider | `driver/get-user-cars/`, `driver/add-user-car/` (`analysis/api_endpoints.txt`) | Implemented, runtime not verified | `rider-app/src/lib/api/garage.ts`, `workers/api/src/routes/rider.ts#L46` | Complete and verified | P2 | High | — |
| **Saved Places (Home/Work)** | Rider | DriveU consumer profile saved addresses | Implemented, runtime not verified | `rider-app/src/lib/api/account.ts`, `workers/api/src/routes/rider.ts#L99` | Complete and verified | P2 | High | — |
| **Fare Estimate & Pricing Quote** | Rider | Base fare, per km, per min, night charges, surge multipliers | Complete and verified | `rider-app/src/lib/api/fare.ts`, `workers/api/src/routes/orders.ts#L13` | Complete and verified | P1 | High | — |
| **Trip Type Selection (In-City/Hourly/Outstation)** | Rider | In-city, round-trip, outstation packages (`FEATURE_FUNCTIONALITY.md` §5.3) | Partially implemented | `rider-app/src/components/booking/TripTypeSelector.tsx`; backend drops package fields in `workers/api/src/routes/orders.ts#L92` | Architecture or reliability risk | P1 | High | FIND-014 |
| **Order Creation Submission** | Rider | `driver/upcoming-bookings/`, booking creation | Present but defective (CRASH) | `rider-app/src/components/booking/BookingSheet.tsx#L538` crashes accessing `order.id` on undefined | Vahanly implementation defect | **P0** | High | **FIND-001** |
| **Hardcoded Fallback Customer ID** | Rider | Authenticated calls require driver_id + IMEI | Present but defective | `workers/api/src/routes/orders.ts#L89` falls back to `c81d4e2e-bcf2-11e6-869b-7df243852131` | Security or privacy risk | **P0** | High | **FIND-010** |
| **Job Offer Ring & Countdown Screen** | Driver | `IncomingActivity` takeover with audio ring & countdown (`FEATURE_FUNCTIONALITY.md` §1) | UI only / 404 on API | `client-app/src/components/OfferScreen.tsx`, `useOfferStore.ts`; API route `/api/v1/driver/offer` missing in `workers/api` | Cross-role workflow gap | **P0** | High | **FIND-002** |
| **Driver Offer Acceptance / Rejection** | Driver | `driver/opt-booking/v2/`, `driver/reject-booking/` (`analysis/api_endpoints.txt`) | UI only / 404 on API | `client-app/src/api/client.ts#L521` calls `PATCH /api/v1/driver/orders/:id/offer-response` (missing in `workers/api`) | Cross-role workflow gap | **P0** | High | **FIND-002** |
| **Driver Direct Auto-Assignment Bypass** | Backend | DriveU offers trips to drivers before binding | Present but defective | `workers/api/src/queue.ts#L36` immediately updates DB to `ASSIGNED` without waiting for driver acceptance | Cross-role workflow gap | **P0** | High | **FIND-002** |
| **Dispatch Polling Synchronization** | Rider | Polling upcoming trip status | Present but defective | `rider-app/app/(app)/dispatch/page.tsx#L218` waits for `EN_ROUTE_TO_PICKUP`, but backend sets `ASSIGNED` | Cross-role workflow gap | **P0** | High | **FIND-007** |
| **Live Driver Tracking on Map** | Rider | Real-time map location updates | Implemented, runtime not verified | `rider-app/src/components/trip/TripMap.tsx`, `RiderStreamManager.ts` | Complete and verified | P1 | High | — |
| **Driver Arrival at Pickup** | Driver | `driver/update-state/` with state `at-point` (`DEEP_DIVE_REPORT.md` §2) | Implemented, runtime not verified | `client-app/src/components/trip/TripArrived.tsx`, `workers/api/src/routes/driver.ts#L121` | Complete and verified | P1 | High | — |
| **Free Wait Timer & Waiting Fees** | Driver / Rider | 5-min free wait at pickup; ₹2/min thereafter (`FEATURE_FUNCTIONALITY.md` §5.3) | Partially implemented | Driver UI tracks timer (`ArrivedVerificationPane.tsx#L203`); backend lacks event update handler | Vahanly implementation defect | P1 | High | FIND-004 |
| **Start OTP Verification** | Driver | Trip start OTP confirmed with customer (`FEATURE_FUNCTIONALITY.md` §5.3) | Present but defective | `workers/api/src/routes/driver.ts#L141` verifies OTP, but contains backdoor `1234` bypass | Security or privacy risk | **P0** | High | **FIND-005** |
| **Odometer & Fuel Start Audit** | Driver | Odometer checkpoint entry on trip start | UI only | `client-app/src/app/driver/trip/live/ArrivedVerificationPane.tsx` captures odo + photo; `workers/api` ignores payload | Vahanly implementation defect | P1 | High | FIND-021 |
| **In-Transit Charges (Tolls / Parking)** | Driver | `BookingModificationActivity` (`driver/b2b-action/`) | UI only / 404 on API | `TripInProgressPane.tsx#L84` adds tolls/parking; calls `/orders/:id/events` which 404s on `workers/api` | Vahanly implementation defect | **P0** | High | **FIND-004** |
| **Emergency SOS Panic Trigger** | Driver / Rider | Accident reporting and emergency contacts (`FEATURE_FUNCTIONALITY.md` §5.6) | Implemented, runtime not verified | `rider-app/src/components/trip/SOSModal.tsx`, `workers/api/src/routes/driver.ts#L320` | Complete and verified | P1 | High | — |
| **Trip End & Final Odometer Audit** | Driver | `makeTripEnd` / `driver/driver-checkout-booking/` | Partially implemented | `TripInProgressPane.tsx` captures end odometer; `workers/api/src/routes/driver.ts#L171` marks COMPLETED | Vahanly implementation defect | P1 | High | FIND-021 |
| **Customer Payment Settlement (Cash)** | Rider | `payment/cash_payment/` confirmed by driver | Implemented, runtime not verified | `workers/api/src/routes/driver.ts`, `rider-app/app/(app)/trip/bill/page.tsx` | Complete and verified | P1 | High | — |
| **Customer Payment Settlement (UPI)** | Rider | Native Juspay HyperSDK UPI / intent (`DEEP_DIVE_REPORT.md` §5) | Mock or placeholder | `rider-app/app/(app)/trip/bill/page.tsx#L125` fires fake UPI URL with competitor VPA `d4m@ybl` and `setTimeout(800)` | Security / Financial Risk | **P0** | High | **FIND-003** |
| **Customer Payment Settlement (Wallet)** | Rider | Wallet balance debit (`wallet/balance/driver/`) | Mock or placeholder | `rider-app/app/(app)/trip/bill/page.tsx#L132` runs `setTimeout(1200)` and sets paid; does not call backend | Financial Correctness | **P0** | High | **FIND-003** |
| **Customer Payment Settlement (Card)** | Rider | Native Juspay checkout (`JuspayCheckoutActivity`) | Mock or placeholder | `rider-app/app/(app)/trip/bill/page.tsx#L136` instantly marks paid without contacting any gateway | Financial Correctness | **P0** | High | **FIND-003** |
| **Driver Instant Withdrawal** | Driver | `WithdrawMoneyActivity` instant payout to bank account (`DEEP_DIVE_REPORT.md` §1) | Partially implemented | `client-app/src/app/driver-account/wallet/page.tsx`, `workers/api/src/routes/driver.ts#L254` (requested only, no rail) | Operational readiness gap | P1 | High | FIND-016 |
| **Driver KYC Document Onboarding** | Driver | Aadhaar, PAN, DL, eShram + DigiLocker WebView (`FEATURE_FUNCTIONALITY.md` §1) | UI only / 404 on API | `client-app/src/app/driver-onboarding/page.tsx` uploads docs; backend lacks multipart KYC upload handler | Operational readiness gap | P1 | High | FIND-011 |
| **Admin KYC Review & Approval Queue** | Admin | Internal ops review portal | UI only / 404 on API | `frontend/src/admin/pages/DriverOnboardingQueue.tsx`; endpoints `/admin/drivers/onboarding` missing in `workers/api` | Operational readiness gap | P1 | High | FIND-011, FIND-017 |
| **Admin Live Control Room Radar** | Admin | Real-time active fleet & trip tracking | Implemented, runtime not verified | `frontend/src/admin/ControlRoomDashboard.tsx`, `workers/api/src/routes/admin.ts#L10` | Complete and verified | P1 | High | — |
| **Admin Real-Time Demand Heatmap** | Admin | `HeatMapActivity` demand zones (`FEATURE_FUNCTIONALITY.md` §1) | Implemented, runtime not verified | `frontend/src/admin/ControlRoomDashboard.tsx`, `workers/api/src/routes/stream.ts#L97` (SSE) | Complete and verified | P1 | High | — |
| **Order Cancellation Authorization** | Rider | Customer cancels booking with cancellation fee check | Present but defective | `workers/api/src/routes/orders.ts#L245` allows deleting any order without verifying caller ID | Security or privacy risk | **P0** | High | **FIND-008** |
| **Admin Role Spoofing Header** | Admin | Role-based permission checks | Present but defective | `frontend/src/admin/pages/DriverOnboardingQueue.tsx#L169` passes unauthenticated `X-Admin-Role: ADMIN` | Security or privacy risk | **P0** | High | **FIND-009** |
| **Driver Fatigue & Break Reminders** | Driver | Push notifications for `coffee_break`, `water_drip` (`FEATURE_FUNCTIONALITY.md` §5.7) | Backend only (Go) / Missing (Workers) | Migration `000065` exists; `workers/api` has no fatigue tracking logic | Reference-product parity gap | P2 | Medium | FIND-022 |
| **Floating Overlay Status Bubble** | Driver | Native Android `SYSTEM_ALERT_WINDOW` `BubbleService` (`FEATURE_FUNCTIONALITY.md` §2) | Missing after scoped inspection | Not implemented in Capacitor driver app; relies on web browser / WebView | Proposed product improvement | P3 | High | — |
| **Aggregator Integration (Rapido)** | Driver | `driver/rapido-fare/` and Rapido trip lifecycle (`DEEP_DIVE_REPORT.md` §2) | Missing after scoped inspection | Not applicable for Vahanly MVP | Not applicable | P3 | High | — |
