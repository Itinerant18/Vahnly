# Quality Assurance Test Plan & Release Acceptance Matrix

- **Date:** 2026-11-12
- **Audit Target:** Comprehensive Test Architecture & Acceptance Criteria
- **Auditor:** QA Lead & Senior Mobile Product Architect

---

## 1. Existing vs. Proposed Test Coverage

### 1.1 Existing Tests Inventory (11 Total Test Files)
- **`rider-app` (5 files):**
  - `src/components/booking/BookingSheet.test.tsx` (Renders trip type selector & estimate triggers)
  - `src/components/trip/OTPDisplay.test.tsx` (Renders 4-box OTP digits)
  - `src/lib/api/client.test.ts` (Smoke tests token storage & error wrapping)
  - `src/lib/store/authStore.test.ts` (Login state setter tests)
  - `src/lib/store/bookingStore.test.ts` (Address and car selection state updates)
- **`client-app` (4 files):**
  - `src/components/ds/BottomSheet.test.tsx` (Drawer drag interactions)
  - `src/components/ds/FareDisplay.test.tsx` (Currency formatting ₹)
  - `src/api/client.test.ts` (Base request headers check)
  - `src/store/useAuthStore.test.ts` (Driver auth state tests)
- **`frontend` (2 files):**
  - `src/components/ds/DataTable.test.tsx` (Table sorting & pagination)
  - `src/network/__tests__/NetworkEngineE2EMocks.test.ts` (Mock WebSocket echo tests)
- **`workers/api` & `workers/cron`:** **0 test files** (Completely unverified).

---

## 2. Comprehensive Test Suites (Proposed New Tests)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PROPOSED TEST SUITES                             │
├────────────────────────────────┬────────────────────────────────────────────┤
│ Suite 1: Critical Happy Paths  │ End-to-end multi-role trip lifecycle       │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Suite 2: Security & Permissions│ Authorization, backdoor, IDOR, and lockout │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Suite 3: Concurrency & Idem    │ Race conditions, double submits, webhooks  │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Suite 4: Edge Connectivity     │ Reconnects, offline queues, app kills      │
├────────────────────────────────┼────────────────────────────────────────────┤
│ Suite 5: Financial Settlement  │ Gateway intents, commission, driver payout │
└────────────────────────────────┴────────────────────────────────────────────┘
```

---

### Suite 1: Critical Happy Path E2E Scenarios

| Test Case ID | Test Scenario | Steps | Expected Result | Layer Verified |
|:---|:---|:---|:---|:---:|
| **E2E-01** | Full Trip Lifecycle (Rider & Driver) | 1. Rider books SEDAN in Kolkata.<br>2. Driver receives incoming offer modal within 2s.<br>3. Driver accepts offer.<br>4. Driver arrives at pickup.<br>5. Driver enters rider's start OTP.<br>6. Driver completes trip.<br>7. Rider pays via UPI.<br>8. Receipt displays. | Both rider and driver apps transition through all 7 states without manual page reloads or errors. Order marked `PAID`. | Cross-role (Rider, Driver, Worker, DB) |
| **E2E-02** | Scheduled Airport Booking | 1. Rider books trip scheduled 4 hours in advance.<br>2. Order saves as `SCHEDULED`.<br>3. Cron runs 15m prior to trip.<br>4. Order dispatches to nearest driver. | Order is NOT dispatched immediately. At T-15m, driver receives offer. | Jobs (`workers/cron`), DB |
| **E2E-03** | Driver Document KYC Approval | 1. Driver uploads DL & PAN.<br>2. Admin opens KYC Kanban.<br>3. Admin inspects photos and clicks Approve.<br>4. Driver toggles duty ONLINE. | Driver is unblocked from duty toggle only after admin approval is recorded in DB. | Admin, Storage (R2), Driver |

---

### Suite 2: Negative, Security & Permission Tests

| Test Case ID | Test Scenario | Steps | Expected Result | Threat Guarded |
|:---|:---|:---|:---|:---:|
| **SEC-01** | Backdoor OTP Rejection | 1. Trip started with real OTP `7492`.<br>2. Driver attempts start with `otp: '1234'`. | Returns `400 Invalid OTP`. Trip status remains `ARRIVED`. | Backdoor bypass (FIND-005) |
| **SEC-02** | OTP 3-Attempt Lockout | 1. Driver enters wrong OTP 3 consecutive times. | 3rd failure returns `403 OTP_LOCKED`. Trip cannot be started without admin support intervention. | Brute-force OTP guessing |
| **SEC-03** | Cross-Account Cancellation IDOR | 1. User A creates order `UUID-1`.<br>2. User B calls `DELETE /api/v1/rider/orders/UUID-1/cancel`. | Returns `404 Not Found` or `403 Forbidden`. Order `UUID-1` remains active. | Unauthorized cancellation (FIND-008) |
| **SEC-04** | Anonymous Order Flood | 1. Unauthenticated script sends `POST /api/v1/orders`. | Returns `401 Unauthorized`. No row inserted in PostgreSQL. | Phantom order spam (FIND-010) |
| **SEC-05** | Admin Header Spoofing | 1. Request to `/api/v1/admin/drivers/onboarding` with header `X-Admin-Role: SUPER_ADMIN` but no valid session cookie. | Returns `401 Unauthorized`. Access denied. | Role escalation (FIND-009) |

---

### Suite 3: Concurrency, Race Conditions & Idempotency

| Test Case ID | Test Scenario | Steps | Expected Result | Risk Guarded |
|:---|:---|:---|:---|:---:|
| **CONC-01** | Rapid Double Booking Click | 1. Rider clicks "Book Driver" twice within 100ms with identical `Idempotency-Key`. | First call returns HTTP 201; second call returns cached response from `SessionDO`. Exactly 1 order created in DB. | Duplicate booking submission |
| **CONC-02** | Simultaneous Driver Acceptance | 1. System mistakenly offers Order A to Driver 1 and Driver 2.<br>2. Both drivers tap Accept simultaneously. | `CityDispatchDO.ctx.blockConcurrencyWhile` ensures exactly 1 driver acquires the assignment; 2nd driver receives "Offer already taken". | Race condition in dispatch |
| **CONC-03** | Duplicate Payment Webhook Replay | 1. Payment gateway sends webhook `status='SUCCESS'` for Order A.<br>2. Gateway retries identical webhook 30s later. | Webhook returns HTTP 200, but only 1 credit entry is written to `ledger_entries`. | Duplicate accounting credits |

---

### Suite 4: Connectivity, Lifecycle & Resilience

| Test Case ID | Test Scenario | Steps | Expected Result | Resilience Factor |
|:---|:---|:---|:---|:---:|
| **RES-01** | WebSocket Drop During In-Transit | 1. Trip is `IN_TRANSIT`.<br>2. Airplane mode enabled for 10s on rider phone.<br>3. Airplane mode disabled. | `RiderStreamManager` auto-reconnects with exponential jitter, fetches fresh ticket, resumes live map track. | Network resilience |
| **RES-02** | App Process Kill / Cold Start | 1. Rider in live trip kills browser/app process.<br>2. Rider relaunches app. | App queries `/api/v1/rider/orders/active`, detects `IN_TRANSIT` order, and immediately redirects to `/trip/live`. | Session persistence |
| **RES-03** | Driver Phone Battery Dies | 1. Driver assigned to trip goes offline for >3 minutes.<br>2. Cron minute sweep detects dead heartbeat. | Driver marked `OFFLINE`. Order is unassigned, returned to `CREATED`, and offered to nearest available driver. | Stranded order recovery |

---

## 3. Pre-Release Acceptance Checklist

Before tagging release candidate `v1.0.0-rc1` for production rollout in Kolkata:

- [ ] **Contract Integrity:** `rider-app` booking sheet completes without JavaScript `TypeError`.
- [ ] **Dispatch Ring:** Driver terminal receives audible ring and 15s countdown on incoming offers.
- [ ] **No Security Backdoors:** Zero occurrences of `1234` or `123456` testing bypasses in backend routes.
- [ ] **Real Payments:** Payment settlement requires an authorized gateway intent; fake `setTimeout` removed.
- [ ] **Brand Scrubber:** Zero occurrences of `d4m` or `DriverforU` in any client bundle or database column.
- [ ] **Admin Porting:** KYC approval queue, live trip radar, and dispute cancellation operational on `frontend`.
- [ ] **Automated Tests:** Miniflare test suite in `workers/api` passes with 100% green status on CI.
- [ ] **Data Archival:** Postgres cron table pruning configured to prevent Neon 0.5 GB exhaustion.
