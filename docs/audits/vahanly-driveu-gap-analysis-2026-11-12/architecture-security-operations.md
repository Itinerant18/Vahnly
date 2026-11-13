# Architecture, Security & Operational Readiness Audit

- **Date:** 2026-11-12
- **Audit Target:** Vahanly System Architecture, Threat Modeling & Infrastructure Stability
- **Auditor:** Principal Software Engineer, Security Architect & Site Reliability Lead

---

## 1. Technical Architecture & System Risks

### 1.1 The Bifurcated Architecture (Go Microservices vs. Cloudflare Edge)
The single greatest architectural risk facing Vahanly is the **unreconciled architectural split** between the original Go microservice platform (`cmd/*`, `internal/*`) and the recently migrated Cloudflare Workers serverless stack (`workers/api`, `workers/cron`).

```
[Original Specification & Contracts]              [Active Deployment Target]
Go Gateway (80+ Endpoints, 80+ Test Suites)  ──>  Cloudflare Workers (15 Endpoints, 0 Tests)
Kafka Event Streaming                         ──>  Cloudflare Queues (3 Events Handled)
Redis Cluster H3 Spatial ZSETs                ──>  CityDispatchDO SQLite In-Memory Index
Triton XGBoost ETA Correction                 ──>  Synchronous Haversine Fallback
PostGIS Relational DB (125 Migrations)        ──>  Neon Postgres via Hyperdrive (0.5 GB Limit)
```

**Risk Assessment:**
- The Go backend was architected with rich domain modeling, concurrency safeguards, contraction-hierarchies road graphs, and forensic odometer audits.
- The Cloudflare Worker port was implemented as an incomplete rapid prototype to achieve a "$0/month hosting" goal (`ADR-cloudflare-migration.md`), dropping dozens of endpoints and state machines that the frontends rely upon.
- As a result, the frontends (`client-app`, `rider-app`, `frontend`) are calling endpoints that existed in Go but return 404 on the Workers edge.

### 1.2 Free-Tier Quota & Scalability Constraints

| Cloudflare / Neon Resource | Free Tier Limit | Production Workload Requirement (60 Active Drivers) | Risk Level |
|:---|:---|:---|:---:|
| **Worker CPU Time** | 10 ms per invocation | Lightweight Hono handlers take 2–6 ms; route calculations in `orders/quote` can spike to 15–25 ms | **HIGH** |
| **KV Writes** | 1,000 writes / day | 5-second surge updates can easily exhaust 1,000 writes in <2 hours if not strictly delta-checked | **HIGH** |
| **Cloudflare Queues** | 10,000 ops / day | 1,000 daily bookings × 6 lifecycle events = 6,000 ops. Safe for pilot, breaks on scale | **MEDIUM** |
| **Neon PostgreSQL Storage** | 0.5 GB (500 MB) | GPS breadcrumb trail logging (`orders_gps_trail`) accumulates ~1.5 MB/hour per active driver. 500 MB will fill in ~10 days without aggressive archiving | **HIGH** |
| **Cron Trigger Resolution** | 1 minute (`* * * * *`) | Driver offer timeouts (15s) and urgent re-dispatching cannot be handled by cron; must live in Durable Object alarms | **MEDIUM** |

### 1.3 Durable Objects & In-Memory Spatial Matching
- `CityDispatchDO` manages driver positions in an in-memory SQLite table `driver_index`.
- When an isolate restarts or migrates between Cloudflare edge data centers, `CityDispatchDO` relies on its SQLite persistence. However, driver freshness thresholds (`ts >= now - 90s`) mean that if a driver's phone stops polling, they are retained in SQLite until the 3-minute sweep runs.
- The matching algorithm uses simple Haversine Euclidean distance over H3 rings rather than actual street road networks, leading to sub-optimal driver assignments across Kolkata's river crossings (e.g., matching a driver in Howrah for a pickup in Burrabazar across the Hooghly River).

---

## 2. Security & Privacy Audit

### 2.1 Threat Modeling & Vulnerability Findings

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CRITICAL ATTACK SURFACES                         │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ FIND-005: Universal Backdoor OTP     │ Anyone can enter '1234' to start     │
│                                      │ trips without customer knowledge     │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ FIND-006: Hardcoded SMS OTP '123456' │ Account takeover on any phone number │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ FIND-008: IDOR on Cancellation       │ Anyone can cancel any active trip in │
│                                      │ the city via DELETE /rider/orders/id │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ FIND-009: Admin Role Header Spoofing │ Sending 'X-Admin-Role: SUPER_ADMIN'  │
│                                      │ allows self-approving KYC documents  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ FIND-010: Phantom Customer Creation  │ Unauthenticated POST /orders creates │
│                                      │ bookings under hardcoded UUID        │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 2.2 Comparison with DriveU Reference Security Posture

| Security Dimension | DriveU Reference Architecture | Vahanly Current Implementation | Security Recommendation |
|:---|:---|:---|:---|
| **API Transport Auth** | ⚠️ Weak: Passes `driver_id` + `imei` in query strings & FormData. No Bearer tokens | ✅ Stronger: Signs standard RS256 / HS256 JWT Bearer tokens | Preserve Vahanly's JWT model; do not copy DriveU's IMEI auth |
| **Trip Verification** | ✅ Strong: Customer provides unique PIN; driver cannot start trip without it | ❌ Defective: Universal backdoor `1234` permits bypass | Remove `1234` immediately; enforce 3-attempt lockout |
| **Phone Verification** | ✅ Real carrier SMS / Firebase Auth integration | ❌ Defective: Hardcoded `'123456'` permits account takeover | Integrate DLT-approved Indian SMS gateway |
| **Network Encryption** | ⚠️ Weak: Android manifest sets `cleartextTrafficPermitted=true`; calls `web0.driveu.in` over HTTP | ✅ Strong: Enforces HTTPS and HSTS (`max-age=31536000`) across all edge routes | Preserve Vahanly's strict TLS posture |
| **Payment Verification** | ✅ Native Juspay HyperSDK with cryptographic server verification | ❌ Defective: Client-side fake `setTimeout` with competitor VPA | Implement real payment SDK with HMAC-SHA256 webhooks |
| **Object Authorization** | Restricted by IMEI + Driver ID pairing | ❌ Defective: Missing `customer_id` check on cancel endpoint | Enforce row-level ownership checks on all mutating queries |

---

## 3. Financial Correctness & Ledger Audit

### 3.1 Server-Authoritative Pricing vs. Client Overrides
- In `workers/api/src/routes/orders.ts`, the quote and fare estimate logic correctly runs on the server (`calculateFare`).
- However, when adding extra charges (tolls, parking, waiting), the client sends arbitrary amounts that the backend fails to validate against receipt evidence or maximum allowable caps.

### 3.2 Webhook Idempotency & Duplicate Replays
- In `workers/api/src/routes/payments.ts#L64`:
  ```ts
  await sql`
    INSERT INTO ledger_entries (entry_type, amount_paise, reference_id, description)
    VALUES ('PAYMENT_RECEIVED', ${payload.amount_paise || 0}, ${payload.order_id}, 'Webhook payment success')
  `.catch(() => {});
  ```
- Payment gateways commonly retry webhooks 5–10 times if edge networks acknowledge with latency >2s.
- Because `ledger_entries` does not have a unique constraint on `(reference_id, entry_type)`, retried webhooks insert **duplicate credit entries**, causing severe financial accounting divergence.

### 3.3 Driver Wallet & Payout Controls
- The driver wallet is currently a pure database stub. When a customer pays via cash, the platform commission (typically 15–20%) is **never deducted** from the driver's wallet balance.
- Over time, drivers will collect 100% of cash fares without the platform retaining its revenue cut.

---

## 4. Operational Readiness & Reliability

### 4.1 Automated Testing Posture
- `workers/api`: **0 test files** (0% coverage).
- `workers/cron`: **0 test files** (0% coverage).
- `rider-app`: 5 component/unit test files (`BookingSheet.test.tsx`, `OTPDisplay.test.tsx`, `client.test.ts`, `authStore.test.ts`, `bookingStore.test.ts`).
- `client-app`: 4 component/unit test files (`BottomSheet.test.tsx`, `FareDisplay.test.tsx`, `client.test.ts`, `useAuthStore.test.ts`).
- `frontend`: 2 test files (`DataTable.test.tsx`, `NetworkEngineE2EMocks.test.ts`).
- **Conclusion:** There is **zero automated verification** of the actual backend API that runs in production.

### 4.2 Logging, Tracing & Error Monitoring
- Sentry is integrated on all three frontends (`@sentry/nextjs` in `rider-app` and `client-app`, `@sentry/react` in `frontend`).
- However, `workers/api` lacks structured Sentry or OpenTelemetry instrumentation; unhandled exceptions on Cloudflare Workers simply output to console logs, which are lost once isolate sessions terminate unless Cloudflare Logpush is explicitly configured.

### 4.3 Database Archival & Backup Strategy
- Neon Serverless Postgres provides automatic point-in-time recovery (PITR).
- However, the 0.5 GB storage cap requires an automated data lifecycle policy:
  1. GPS breadcrumbs in `orders_gps_trail` must be pruned or compressed into Parquet/JSON lines and exported to Cloudflare R2 after 7 days.
  2. Audit logs in `audit_logs` must be archived after 30 days.

---

## 5. Recommended Architecture Adjustments

1. **Unify Contracts on `workers/api`:** Complete the migration by porting the missing Go handlers for driver offers, onboarding queues, in-transit events, and ledger reconciliation into TypeScript on `workers/api`.
2. **Eliminate Security Backdoors:** Purge all hardcoded bypass codes (`1234`, `123456`, `c81d4e2e-...`) and enforce server-side cryptographic authentication on all administrative endpoints.
3. **Implement Real Payment Rails:** Integrate Juspay HyperSDK or Razorpay Standard Checkout on `rider-app` with idempotent server-side webhook processing.
4. **Deploy DO-Driven Offer Timers:** Replace minute-cron dispatch polling with high-precision Durable Object alarms (`ctx.storage.setAlarm(Date.now() + 15000)`) to drive the 15-second driver offer lifecycle.
