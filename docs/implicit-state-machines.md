# Implicit State Machines

An inventory of every place in this repository where a lifecycle, status, or mode is encoded ad hoc — booleans, string unions, parallel stores, raw string comparisons — instead of as a single explicit state machine with a guarded transition table.

**Scope:** `rider-app` (rider web), `client-app` (driver web/Capacitor), `frontend` (admin control room), `workers/api` + `workers/cron` (Cloudflare Workers), and the Go services under `internal/`.

**Method:** static reading of the stores, screens, Durable Objects, workflows, HTTP handlers, and the canonical SQL enum definitions in `migrations/`. No runtime testing; findings are code-level. `graphify` was not usable for this pass — `graphify-out/graph.json` is ~600 MB, above the tool's parse cap, and raising the cap pulls in decompiled-APK noise from `DriveU_apk_for_rea`.

**Excluded:** `DriveU_apk_for_rea` decompiled trees.

**Summary:** 14 distinct machines. 5 of them have two or more competing implementations. Only one — the driver duty store — has an actual transition table, and even that one is bypassed by its own callers.

---

## Index

| # | Machine | Implementations | Worst symptom |
| --- | --- | --- | --- |
| 1 | [Ride order lifecycle](#1-ride-order-lifecycle) | 6 | Cron and `workers/api` write enum values the DB rejects, silently |
| 2 | [Driver duty / availability](#2-driver-duty--availability) | 3 client + DB | Driver can go offline mid-trip |
| 3 | [Offer / lease](#3-offer--lease) | 2 client + 2 server timers | Compare-and-set is a no-op; 15s/20s race |
| 4 | [Connection / transport](#4-connection--transport) | refs + booleans | No canonical "connected" answer |
| 5 | [Auth / session / phone verification](#5-auth--session--phone-verification) | 4 | Multi-step login lost on refresh |
| 6 | [Onboarding / KYC](#6-onboarding--kyc) | 3 | Queued steps never upload (key mismatch) |
| 7 | [Payment / settlement](#7-payment--settlement) | 4 | Rider bill fakes payment with `setTimeout` |
| 8 | [SOS / incident](#8-sos--incident) | 3 + admin | `EMERGENCY` has no exit; acknowledge always "succeeds" |
| 9 | [Offline mutation queue](#9-offline-mutation-queue) | 1 | One poison item blocks the queue forever |
| 10 | [Document expiry](#10-document-expiry) | 1 | Never actually expires anything |
| 11 | [Backend dispatch / outbox](#11-backend-dispatch--outbox) | 2 (DO + Go) | No sequence numbers, so clients can't order events |
| 12 | [Admin verification / onboarding boards](#12-admin-verification--onboarding-boards) | 2 | Unrestricted Kanban drag; mock fallback data |
| 13 | [Admin trip detail actions](#13-admin-trip-detail-actions) | 1 | "Reopen Trip" returns order to `CREATED` |
| 14 | [Rating submission](#14-rating-submission) | 2 | Marks submitted even when the API call fails |

---

## 1. Ride order lifecycle

**Canonical definition** (`database/migrations/000001_init_platform_schema.up.sql`, `000004_add_arrived_status.up.sql`):

```
CREATED → SEARCHING → ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED → IN_PROGRESS → COMPLETED
                                                                          ↘ CANCELLED
```

Six places encode this independently, and two of them disagree with the enum.

| Where | Encoding | States |
| --- | --- | --- |
| `database/migrations/000001_*`, `000004_*` | Postgres enum | `CREATED, SEARCHING, ASSIGNED, EN_ROUTE_TO_PICKUP, ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED` |
| `rider-app/app/(app)/dispatch/page.tsx` | local union `DispatchState` | `BOOKING \| SEARCHING \| TIMEOUT` |
| `rider-app/app/(app)/trip/LiveTripView.tsx` | event handler, no guard | mirrors server events verbatim |
| `client-app/src/store/useTripStore.ts` | string field | subset of the DB enum |
| `workers/api/src/routes/driver.ts` | string literals | `ARRIVED → IN_TRANSIT → COMPLETED` — **not DB values** |
| `frontend/src/admin/pages/TripDetail.tsx` | raw string comparisons | `COMPLETED` / `CANCELLED` |
| `workers/cron/src/index.ts:68,82` | SQL literals | `EXPIRED`, `SCHEDULED` — **not DB values** |

### Gaps

- **Rider dispatch advances only on `EN_ROUTE_TO_PICKUP`.** A bare `ASSIGNED` event leaves the screen in `SEARCHING`, so a successfully assigned trip can still hit the 60s timeout and flip to `TIMEOUT`. The user sees "no drivers found" for a trip that has a driver.
- **`/rider/active` returning 404 is treated as `TIMEOUT`.** "No active trip" and "request failed" collapse into the same user-visible state.
- **No monotonicity guard in `LiveTripView`.** Every inbound event is applied in arrival order. A late or duplicated `rider.driver.arrived` will drag a `COMPLETED` trip backwards; a stale `SEARCHING` snapshot can do the same.
- **`workers/api` uses a different vocabulary** (`IN_TRANSIT`). If that worker is live, its writes either fail the enum cast or land in a column typed as free text — either way the two backends disagree about what a trip is doing.
- **Cron writes non-existent statuses and swallows the failure.** `workers/cron/src/index.ts:68` sets `status = 'EXPIRED'` and `:82` filters `WHERE status = 'SCHEDULED'`. Neither value exists in the order enum. The surrounding `.catch(() => {})` means the job reports success while doing nothing.
- **Poll + socket + timeout are three independent drivers** of the same local state, with no single authority deciding which one wins.

### Evidence

- `rider-app/app/(app)/dispatch/page.tsx` — `DispatchState`, 3s poll, 60s timeout, `dispatchDown`.
- `rider-app/app/(app)/trip/LiveTripView.tsx` — status assignment from stream events.
- `workers/api/src/routes/driver.ts` — `ARRIVED`/`IN_TRANSIT`/`COMPLETED` transitions.
- `workers/cron/src/index.ts:63-90` — lead-time job and expiry job.

### Fix direction

Add a `version` (or per-order monotonic `seq`) to every stream event and have `LiveTripView` reject anything `<=` the last applied version. Replace `DispatchState` with a projection of the order status rather than an independent machine. Delete `IN_TRANSIT`/`EXPIRED`/`SCHEDULED` and make the cron job fail loudly instead of `.catch(() => {})`.

---

## 2. Driver duty / availability

Three client-side sources plus the database, all writable independently.

| Source | States |
| --- | --- |
| `client-app/src/store/useDriverDutyStore.ts` | `OFFLINE, ONLINE, EN_ROUTE, ARRIVED, IN_TRIP, DELIVERING, COMPLETED, EMERGENCY` + transition table |
| `client-app/src/store/useDriverStore.ts` | `status` string, set independently of the above |
| `client-app/src/lib/store/useAppState.ts` | `ONLINE_BUSY`, `IN_TRIP` — different vocabulary again |
| DB `driver_duty_state` | no `COMPLETED` value |

### Gaps

- **`COMPLETED` exists only on the client.** `useDriverDutyStore.ts:14` declares it, `:41-42` transitions `DELIVERING → COMPLETED → ONLINE`. The Postgres enum has no such value, so the post-trip state can never be confirmed by the server. A refresh rehydrates a state the backend doesn't recognize.
- **`toggleOnlineStatus` bypasses its own guard.** Both branches assign state unconditionally; the transition table is never consulted. A driver can flip `OFFLINE` while `IN_TRIP`.
- **The Go handler doesn't guard either.** `internal/driver/delivery/http/duty_handler.go` accept go-online/go-offline requests with no check against the current duty state or active trip. Whatever the client sends is persisted.
- **`EMERGENCY` is a one-way door.** `duty_handler.go:261` writes `duty_state = 'EMERGENCY'`; nothing in the codebase writes out of it. The driver is permanently unavailable after an SOS until someone edits the row by hand.
- **The real screen states aren't modeled at all.** `client-app/src/app/driver/page.tsx` branches on duty state plus local flags `kycPending`, `isWaiting`, `sosHolding`, `chatOpen`, `showCancelModal`, and has three separate code paths that can present an offer. These combinations are the actual UI state space and none of them are enumerated.

### Evidence

- `client-app/src/store/useDriverDutyStore.ts:14,41-42` — `COMPLETED` state and transitions.
- `client-app/src/lib/store/useAppState.ts` — second vocabulary.
- `internal/driver/delivery/http/duty_handler.go:260-261` — SOS write, no exit.

### Fix direction

Pick `useDriverDutyStore` as the only client machine, delete `useDriverStore.status` and `useAppState.driverState`, and route every mutation through one `transition(event)` function that validates against the table. Mirror the table server-side in `duty_handler.go` (reject `OFFLINE` when an active order exists, reject `ONLINE` when `kycPending`). Add a defined exit from `EMERGENCY` (`RESOLVED → ONLINE`) and a matching DB value for `COMPLETED`, or drop it from the client.

---

## 3. Offer / lease

Two client stores and two server-side timers describe the same lease.

- `client-app/src/store/useOfferStore.ts`: `IDLE → OFFER_PENDING → ACCEPTED | DECLINED`.
- Delivery has **three writers into the same store**: WS `AssignmentFrame`, a 10s REST poll, and an FCM foreground push. No dedupe key, no ordering.
- The 15s countdown is implemented twice: `client-app/src/components/OfferScreen.tsx` and `OfferPopup.tsx`.

### Gaps

- **Optimistic accept with an illegal revert.** `acceptOffer` advances to `EN_ROUTE` before the server confirms. On failure it tries to revert to `OFFER_PENDING`, a transition the table forbids (`EN_ROUTE` has no edge back). The revert is dropped, leaving the store in a state the machine says is impossible — driver en route to a trip they never got.
- **Compare-and-set is a no-op.** `workers/api/src/durable-objects/CityDispatchDO.ts` — `accept(driver, version)` accepts a `version` argument and never reads it. Two concurrent accepts both succeed; the second silently overwrites the first.
- **Stale sweep is 8× the client lease.** `matchOrder` reserves a driver as `ASSIGNED` without updating `ts`, so the 120s stale sweep is the only thing that releases them. The client gave up at 15s.
- **Two timers race in the 15–20s window.** `internal/dispatch/expiry/timeout_manager.go` rolls back the offer at 15s and writes a Redis `offer:forcematch:*` skip marker. `internal/dispatch/reconciler/order_reconciler.go` re-emits `order.assigned` for orders `ASSIGNED` longer than 20s. A trip released at 15s can be re-offered at 20s to the same or a different driver, with no record of the first attempt.
- **Offer status is effectively a fourth driver-status source.** `OFFER_PENDING` implies "busy" but neither `useDriverDutyStore` nor `useAppState` knows about it.

### Evidence

- `client-app/src/store/useOfferStore.ts` — parallel machine, optimistic accept.
- `client-app/src/components/OfferScreen.tsx`, `client-app/src/components/OfferPopup.tsx` — duplicated countdown.
- `workers/api/src/durable-objects/CityDispatchDO.ts` — `accept`, `matchOrder`.
- `internal/dispatch/expiry/timeout_manager.go` — 15s rollback + skip marker.
- `internal/dispatch/reconciler/order_reconciler.go` — 20s re-emit.

### Fix direction

Make accept a real CAS: read and compare `version` in the DO, return `CONFLICT` on mismatch, and have the client treat `CONFLICT` as "offer gone" rather than reverting. Align the janitor and reconciler on one timeout (15s), or have the reconciler skip anything carrying a `forcematch` marker. Keep one countdown component.

---

## 4. Connection / transport

`ClientCoreEngine.ts`, `ResilientStreamManager.ts`, `useResilientWebSocket.ts`, and `ResilientWebSocketProvider.tsx` collectively hold connection state across refs, booleans, and retry counters. There is no single value like `CONNECTING | OPEN | DEGRADED | CLOSED`.

Consumers each derive their own view:

- Rider dispatch has `dispatchDown`.
- Driver screens have separate stream-ready flags.
- Retry/backoff state lives in refs that don't trigger renders, so the UI and the engine can disagree about whether a reconnect is in progress.

Consequence: "am I connected" has no canonical answer, degraded vs. down can't be distinguished, and a screen can render a stale connected state while the engine is in backoff.

### Fix direction

Expose one `connectionState` value from the provider with an explicit transition table (`CONNECTING → OPEN → DEGRADED → CLOSED`, `DEGRADED → OPEN`, `CLOSED → CONNECTING`), and make every consumer read it instead of maintaining a flag.

---

## 5. Auth / session / phone verification

Four encodings:

| Where | What it holds |
| --- | --- |
| `client-app/src/store/useAuthStore.ts` | token + hydrated flag |
| `SessionDO` (Worker) | server session lifecycle |
| `PhoneVerificationGate.tsx` | boolean gate |
| `client-app/src/components/auth/PhoneVerifyScreen.tsx` + login screen | local step state |

### Gaps

- **Multi-step login is component state.** The sequence `Reset & Log In → Create password & continue → Complete Registration` only exists as local state in the login page. A refresh or back-navigation loses the step, and the server has no idea where the user is, so it can't resume or reject out of order.
- **Session expiry is discovered per-request.** There is no `AUTH_EXPIRED` transition; each in-flight flow (offer accept, trip action, rating) fails independently on its own 401 instead of the app moving to a single `REAUTH` state.
- **`PhoneVerificationGate` is a separate boolean** from the auth store, so "logged in" and "phone verified" can disagree during rehydration.

### Fix direction

Model login as `ANONYMOUS → OTP_SENT → OTP_VERIFIED → PASSWORD_SET → REGISTERED`, persisted server-side against the session, with the client rendering from that value. Add an `AUTH_EXPIRED` global transition triggered by any 401.

---

## 6. Onboarding / KYC

Three encodings:

| Where | Encoding |
| --- | --- |
| `client-app/src/store/useDriverOnboardingStore.ts` + `client-app/src/app/driver-onboarding/page.tsx` | step index, resumable |
| `frontend/src/admin/pages/DriverOnboardingQueue.tsx` | 5-stage Kanban, **unrestricted drag-and-drop** |
| `frontend/src/admin/DriverVerificationQueue.tsx` | `PENDING_VERIFICATION \| OFFLINE \| ONLINE_AVAILABLE` — mixes KYC status with availability |

### Gaps

- **Kanban drag has no transition validation.** An operator can move a driver backwards or skip stages; the server accepts whatever status is posted.
- **`DriverVerificationQueue` falls back to mock data** when the API fails, so an admin can approve or reject a fabricated driver.
- **Offline queue key mismatch.** `useDriverOnboardingStore` writes `driver-onboarding-offline-queue`; `client-app/src/api/client.ts` drains `onboarding-offline-queue`. Queued onboarding steps are never uploaded — they sit in storage forever.
- **`kycPending` is a fourth source.** `client-app/src/app/driver/page.tsx` gates the driver UI on a local boolean that is independent of the store, the Kanban, and the verification queue.

### Fix direction

Define `DRAFT → SUBMITTED → DOCS_REVIEW → BACKGROUND_CHECK → APPROVED | REJECTED` once, share the enum between client and admin, validate transitions in the API, and remove the mock fallback (fail closed with an explicit error state). Fix the queue key. Delete `kycPending` and derive it from onboarding status.

---

## 7. Payment / settlement

### Rider bill

`rider-app/app/(app)/trip/bill/page.tsx` "processes" payment with a `setTimeout` and then shows success. **No payment endpoint is called.** The order is marked paid in the UI only; the backend never learns about it.

### Driver bill

`client-app/src/app/driver/trip/bill/page.tsx` reads `sessionStorage` keys `final_bill_{orderID}` and `current_final_bill` and **dead-ends if they're missing** — there is no fetch fallback. The bill therefore only exists if the same browser session happened to write it earlier.

### Payouts

- `PayoutBatchWorkflow` performs `REQUESTED → COMPLETED` with `WHERE id = $1` only. A retry or a second worker can overwrite an already-`COMPLETED` or `FAILED` payout. There is no `WHERE status = 'REQUESTED'` guard.
- The cron sandbox auto-settle performs the same transition, so there are **two independent writers** to the payout terminal state.
- `LedgerReconciliation` (admin) reads the result but can't distinguish "settled once" from "settled twice".

### Rating

`client-app/src/app/driver/trip/rate/page.tsx:59-64` sets `submitted = true` even when `rateRider` throws — with the comment *"Even on failure, advance to the next-step choice — the trip is over."* The rating is silently lost and the UI reports success.

### Fix direction

Make the bill server-derived: one `GET /orders/{id}/bill` that returns the authoritative line items, and have both apps render it. Delete the `setTimeout` payment and the `sessionStorage` handoff, or keep an explicit `PENDING → AUTHORIZED → CAPTURED | FAILED` machine on the server. Add `WHERE status = 'REQUESTED'` to every payout transition and remove the cron's duplicate settle. On rating, either queue the failure for retry or show a retry affordance — don't claim success.

---

## 8. SOS / incident

Three machines, none authoritative.

| Layer | States | Enforcement |
| --- | --- | --- |
| `client-app/src/store/useSafetyStore.ts` | `isEmergencyActive` boolean | none |
| DB `drivers.duty_state` | `EMERGENCY` | write-only, no exit |
| `internal/admin/delivery/http/safety_handler.go` | `ACTIVE → ACKNOWLEDGED → RESOLVED` | unconstrained; always returns `SUCCESS` |
| `frontend/src/admin/components/IncidentRecoveryTerminal.tsx` | `UNASSIGNED → INVESTIGATING → RESOLVED` | client-only bypass set |

### Gaps

- **`cancelSOS` clears only local state.** The DB stays `EMERGENCY`, so dispatch sees the driver as unavailable while the app says they're fine. The two views never reconverge.
- **`EMERGENCY` has no exit path** (see §2). The only recovery is a manual row edit.
- **The safety handler always returns `SUCCESS`,** regardless of whether the transition applied. An admin acknowledging an already-resolved incident gets a success toast and no state change.
- **Incident claim has no compare-and-set.** `internal/admin/delivery/http/incident_handler.go` lets two admins both claim the same incident.
- **`FORCE_ABORT` cancels from terminal states** — an incident that is already `RESOLVED` can be aborted again, rewriting history.
- **Admin terminal has a client-only bypass set** (`IncidentRecoveryTerminal.tsx`), so the UI can display transitions the server won't accept.

### Fix direction

One machine: `TRIGGERED → ACKNOWLEDGED → DISPATCHED → RESOLVED | FALSE_ALARM`, stored server-side, with `cancelSOS` issuing a real `TRIGGERED → FALSE_ALARM` transition. Enforce transitions in `safety_handler.go`, return the actual outcome instead of always `SUCCESS`, add `WHERE status = <expected>` to claim and abort, and derive the admin terminal from server state.

---

## 9. Offline mutation queue

`client-app/src/store/useOfflineCacheStore.ts` is unbounded, persisted, flushes on reconnect, and **retries on failure with no terminal state**.

There is no `PENDING → INFLIGHT → FAILED_PERMANENT` distinction, so a permanently-rejected mutation — accepting an offer that has expired, rating a trip that no longer exists — retries forever and blocks every item behind it. One poison item takes out the whole queue.

### Fix direction

Add an attempt counter and a terminal `FAILED_PERMANENT` state with a max-retry policy. Dead-letter instead of blocking. Cap the queue and surface the count in the UI.

---

## 10. Document expiry

`DocExpiryWorkflow` computes expiring documents and **only notifies**. Document status never becomes `EXPIRED`, and warnings have no dedupe key, so the same document warns on every run. Nothing in the read path treats an expired document as unusable — a driver with a lapsed licence remains dispatchable.

### Fix direction

Add `VALID → EXPIRING → EXPIRED` to the document model, have the workflow perform the transition (not just notify), key notifications by `(document_id, threshold)` to dedupe, and gate dispatch eligibility on document status.

---

## 11. Backend dispatch / outbox

`CityDispatchDO` (driver index: `ONLINE_AVAILABLE / ASSIGNED / OFFLINE`), `OrderStreamDO`, `RiderStreamDO`, plus the Go reconciler and janitor.

Events fan out with **no sequence number and no per-order version**, which is the root cause of the rider-side ordering bug in §1: the client has no way to reject a stale event even if it wanted to. The DO driver index and the DB `driver_duty_state` are also separate machines that are reconciled only by the 120s sweep.

### Fix direction

Stamp every event with `(order_id, version)` and have consumers drop non-increasing versions. Publish driver availability changes as events too, so the DO index and the DB can't drift.

---

## 12. Admin verification / onboarding boards

Covered in §6, but worth calling out separately because these are the only places where a human can *drive* a state machine:

- `DriverOnboardingQueue.tsx` — 5-stage Kanban with unrestricted drag-and-drop.
- `DriverVerificationQueue.tsx` — parallel vocabulary (`PENDING_VERIFICATION | OFFLINE | ONLINE_AVAILABLE`), mock fallback data.

Both should consume the same enum as the driver app and submit guarded transitions; the board should render `allowedTransitions` returned by the API rather than permitting arbitrary drops.

---

## 13. Admin trip detail actions

`frontend/src/admin/pages/TripDetail.tsx` gates actions on raw `COMPLETED` / `CANCELLED` string comparisons. "Reopen Trip" sets the order back to `CREATED`, which is not a legal transition from either terminal state and re-enters the dispatch matcher — the order can be re-offered, re-assigned, and re-billed.

### Fix direction

Replace string comparisons with the order-state enum and an `allowedActions` list from the server. Model reopen as `COMPLETED → REOPENED → SEARCHING` (or forbid it) instead of resetting to `CREATED`.

---

## 14. Rating submission

`client-app/src/app/driver/trip/rate/page.tsx:59-64` — on API failure the page still sets `submitted = true` and advances. The written comment makes the intent explicit: *"Even on failure, advance to the next-step choice — the trip is over."*

This is a deliberate choice, but it means the rating is lost with no record and no retry. Either queue it through the offline store (with the terminal-state fix from §9) or surface a retry.

---

## Cross-cutting root causes

1. **No shared enum.** Five vocabularies for order status (`IN_TRANSIT`, `EXPIRED`, `SCHEDULED`, `ARRIVED`, `CREATED`), three for driver status, two for KYC. The database enum is treated as a suggestion.
2. **Client-side optimism without reconciliation.** Offers, payments, ratings, and SOS all advance locally before the server confirms, and the failure paths either revert illegally (§3) or don't revert at all (§7, §8).
3. **Terminal states aren't terminal.** Payout completion, incident resolution, and order reopening all have writes that don't check the current status first.
4. **Silent failure.** `.catch(() => {})` in cron, always-`SUCCESS` in the safety handler, mock fallback in the verification queue, and success-on-error in rating all convert a failed transition into apparent success.
5. **No event ordering.** Without `(id, version)` on stream events, every client-side guard is advisory.

---

## Prioritized fixes

Ordered by blast radius, not effort.

### P0 — correctness and money

1. **Give order events a version and reject stale ones.** Add `version` to `OrderStreamDO`/`RiderStreamDO` payloads; `LiveTripView` drops anything not strictly increasing. Fixes the revert-to-`SEARCHING`/`COMPLETED` class of bugs.
2. **Fix the cron enum writes.** `workers/cron/src/index.ts:68,82` — `EXPIRED` and `SCHEDULED` don't exist. Replace with real statuses and remove `.catch(() => {})` so failures surface.
3. **Guard every payout transition.** `PayoutBatchWorkflow` and the cron sandbox settle both need `WHERE status = 'REQUESTED'`; delete the duplicate writer.
4. **Stop faking payment.** `rider-app/app/(app)/trip/bill/page.tsx` `setTimeout` → real endpoint. `client-app/src/app/driver/trip/bill/page.tsx` `sessionStorage` → server fetch.

### P1 — safety and availability

1. **One driver machine.** Collapse `useDriverDutyStore`, `useDriverStore.status`, `useAppState.driverState`, and `kycPending`; enforce the same table in `duty_handler.go`; add an exit from `EMERGENCY`.
2. **Real CAS on offer accept.** Honour `version` in `CityDispatchDO.accept`, return `CONFLICT`, and stop the illegal `EN_ROUTE → OFFER_PENDING` revert.
3. **Align the lease timers.** 15s janitor vs 20s reconciler — pick one or make the reconciler respect `offer:forcematch:*`.
4. **Real SOS transitions.** `cancelSOS` must write `FALSE_ALARM`; `safety_handler.go` must return the actual outcome; incident claim/abort need status guards.

### P2 — data integrity

1. **Fix the onboarding queue key** (`driver-onboarding-offline-queue` vs `onboarding-offline-queue`) and add a terminal `FAILED_PERMANENT` to `useOfflineCacheStore`.
2. **Make document expiry a transition,** not a notification, with dedupe keys.
3. **Guard admin boards.** Validate Kanban drops server-side; remove the mock fallback in `DriverVerificationQueue`; replace `TripDetail`'s raw string gates and stop `Reopen Trip` from returning to `CREATED`.

---

## Appendix — file index

**Client (driver)**

- `client-app/src/store/useDriverDutyStore.ts`
- `client-app/src/store/useDriverStore.ts`
- `client-app/src/store/useOfferStore.ts`
- `client-app/src/store/useAuthStore.ts`
- `client-app/src/store/useOfflineCacheStore.ts`
- `client-app/src/store/useSafetyStore.ts`
- `client-app/src/store/useDriverOnboardingStore.ts`
- `client-app/src/lib/store/useAppState.ts`
- `client-app/src/network/ClientCoreEngine.ts`
- `client-app/src/network/ResilientStreamManager.ts`
- `client-app/src/api/client.ts`
- `client-app/src/app/driver/page.tsx`
- `client-app/src/app/driver/trip/rate/page.tsx`
- `client-app/src/app/driver/trip/bill/page.tsx`
- `client-app/src/app/driver-onboarding/page.tsx`
- `client-app/src/components/OfferScreen.tsx`
- `client-app/src/components/OfferPopup.tsx`
- `client-app/src/components/PhoneVerificationGate.tsx`
- `client-app/src/components/auth/PhoneVerifyScreen.tsx`

**Rider**

- `rider-app/app/(app)/dispatch/page.tsx`
- `rider-app/app/(app)/trip/LiveTripView.tsx`
- `rider-app/app/(app)/trip/bill/page.tsx`
- `rider-app/src/lib/websocket/RiderStreamManager.ts`
- `rider-app/src/lib/store/tripStore.ts`
- `rider-app/src/lib/store/bookingStore.ts`
- `rider-app/src/lib/api/types.ts`
- `rider-app/src/components/auth/PhoneVerifyScreen.tsx`

**Admin**

- `frontend/src/admin/pages/DispatchDashboard.tsx`
- `frontend/src/admin/pages/TripDetail.tsx`
- `frontend/src/admin/pages/DriverOnboardingQueue.tsx`
- `frontend/src/admin/DriverVerificationQueue.tsx`
- `frontend/src/admin/components/IncidentRecoveryTerminal.tsx`
- `frontend/src/admin/components/LedgerReconciliation.tsx`

**Workers**

- `workers/api/src/durable-objects/CityDispatchDO.ts`
- `workers/api/src/durable-objects/OrderStreamDO.ts`
- `workers/api/src/durable-objects/RiderStreamDO.ts`
- `workers/api/src/routes/driver.ts`
- `workers/cron/src/index.ts`

**Go**

- `internal/driver/delivery/http/duty_handler.go`
- `internal/admin/delivery/http/incident_handler.go`
- `internal/admin/delivery/http/safety_handler.go`
- `internal/dispatch/expiry/timeout_manager.go`
- `internal/dispatch/reconciler/order_reconciler.go`

**Schema**

- `database/migrations/000001_init_platform_schema.up.sql` — order status enum
- `database/migrations/000004_add_arrived_status.up.sql` — `ARRIVED`
- `database/migrations/000042_add_safety_and_incidents_tables.up.sql` — incidents / SOS
- `database/migrations/000059_add_driver_duty_state.up.sql` — `driver_duty_state`
- `database/migrations/000116_add_order_waiting_state.up.sql` — waiting state
