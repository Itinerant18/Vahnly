# Reliability Plan — Rate Limiting · Button Guards · Error/Notification

Lead doc for a non-specialist. Three concerns, grounded in current code (file:line), prioritised by
**risk**. Status: **plan**. Nothing implemented yet.

---

## TL;DR — what's broken and why it matters

| Concern | State today | Worst case if ignored |
| :-- | :-- | :-- |
| **Rate limiting** | Limiter exists, but only on authed order/trip routes. **OTP/login/SOS are wide open.** | **SMS bomb** — someone scripts "send OTP" 10,000× → your Firebase SMS bill explodes; OTP brute-force; SOS spam. |
| **Button double-press** | Booking button guarded; login/OTP/pay/SOS/rating **ad-hoc or unguarded**. | Double bookings, double charges, duplicate OTP sends, two SOS events. |
| **Error / notification** | client-app has a toast store **but doesn't use it**; rider-app has **none**; gateway returns **plain-text** errors. | Users see nothing or a raw code on failure → they retry (worse), or rage-quit. |

---

## Current state (grounded)

**Rate limiting** — `internal/gateway/middleware/ratelimit.go`

- `LimitRouteConcurrency` = sliding-window (Redis ZSET), keyed by **authenticated `userID`** (`ratelimit:user:<id>`), returns **429** on breach, fail-open by default (`SetFailClosed`).
- Wired in `cmd/gateway/main.go:504` at **1000/min**, applied to `HandleCreateOrder` + ~13 driver trip endpoints (`:601, :607-629`).
- ⚠ **Keyed by userID → useless for pre-auth endpoints** (OTP/login have no user yet → it 403s). The unprotected list: `driver/rider auth send-otp + verify-otp` (`:579,:580,:698,:699`), `driver/admin login` (`:551,:555`), `driver/rider SOS` (`:591,:661`), promo.

**Button guards** — ad-hoc. Booking guarded (`BookingSheet.tsx:793` `disabled={… bookingState==="loading"}`). Login/OTP (`client-app/login/page.tsx`) tracks `loading` but buttons not reliably disabled; SOS / promo-apply / rating not guarded. No shared helper.

**Error/toast**

- client-app **has** `src/store/useToastStore.ts` (`show(msg, type)`, 4s auto-dismiss) — **but unused**; login uses inline `authError`. No `<Toast>` renderer mounted.
- rider-app **no toast** — inline `bookingError`/`authError` only. Has `notificationStore.ts` (in-app list from WS, not a toast).
- API clients DO throw typed errors (`rider-app/src/lib/api/client.ts` `ApiError{status,code}` from an `ApiEnvelope`; `client-app/src/api/client.ts` `ApiClientError`).
- Gateway returns **plain text** (`http.Error(w, "malformed_json_payload", …)`) — no structured `{error:{code,message}}` envelope.
- Push/FCM: backend `StubFCMSender` (no-op); client-app registers FCM tokens; rider-app does not.

---

## P0 — Stop abuse (do first, deploy on its own)  ✅ SHIPPED

**Goal:** no endpoint can be hammered to cost money or brute-force a code.

**Shipped:** `ratelimit.go` gains `PerKey(keyFn, prefix, limit, window)` (phone/IP keyed, JSON 429) +
`PhoneBodyKey` (rebuffers the body) / `ClientIPKey` extractors; wired in `main.go` to driver+rider
send-otp (phone 3/hr **and** IP 15/hr), verify-otp (phone 5/10m), driver/admin login + firebase-verify
(IP), and all 4 SOS routes (IP 20/min flood-guard). **Fail-open** chosen (a Redis blip must not lock
everyone out of login); `RATE_LIMIT_FAIL_CLOSED=true` hardens it. Extractor unit tests + existing
limiter tests green.

### P0.1 Per-key limiter for pre-auth endpoints (NEW)

The existing limiter keys by user; OTP/login have no user. Add a sibling method:

```
LimitByKey(keyFn func(*http.Request) string, limit int64, window) http.HandlerFunc
```

- `keyFn` extracts the limit key: **phone** (from JSON body) for OTP, **client IP** (X-Forwarded-For / RemoteAddr) for login. Same ZSET sliding-window engine, key `ratelimit:otp:<phone>` / `ratelimit:ip:<ip>`.
- Reading the body in middleware needs care (re-buffer `r.Body` so the handler can still read it) — note in impl.

### P0.2 Apply tight limits

| Endpoint | Key | Limit (proposed) | Why |
| :-- | :-- | :-- | :-- |
| `*/auth/send-otp` | phone **and** IP | 3 / phone / hour · 15 / IP / hour | SMS cost + bomb |
| `*/auth/verify-otp` | phone | 5 / phone / 10 min | OTP brute-force |
| `*/auth/*login` | IP | 10 / IP / 15 min | password spray |
| `promo/validate` | user | 20 / user / min | enumeration |
| **SOS** | user | **30 / user / min** | ⚠ runaway-loop guard ONLY — must NEVER block a real emergency; keep the ceiling high |

### P0.3 Structured 429

`Retry-After` header (already set) + a JSON body via the P2 envelope (`{success:false,error:{code:"rate_limited",message:"…"}}`) so the apps can show a friendly "Too many attempts, try in N min."

**Decision:** fail-open vs fail-closed for the OTP limiter. Recommend **fail-closed on send-otp only** (if Redis is down, don't let the SMS tap run unmetered) and fail-open elsewhere (don't block login during a Redis blip). Confirm.

---

## P1 — Button double-press (data integrity)

**Goal:** one tap = one action; a slow network can't create duplicates.

### P1.1 Shared `useAsyncAction` hook (both apps)

One hook everyone uses for submit buttons:

```
const { run, pending } = useAsyncAction(async () => { … });
<button disabled={pending} onClick={run}>…</button>
```

- Ignores re-entrant calls while `pending` (the actual double-press guard), flips a busy flag, and routes thrown errors to the toast (P2). Replaces the per-component `loading`/`setLoading` boilerplate.

### P1.2 Server-side idempotency (the real fix for money/orders)

Client guards are UX; the correctness fix is idempotency. `X-Idempotency-Key` is **already allow-listed** in CORS (`cors.go`) — verify whether the gateway honours it; if not, wire dedup on **create-order** and **confirm-payment** (store key→result, replay on repeat). A retried tap then returns the first result, never a second order/charge.

### P1.3 Audit + guard every submit

Book · Send/Verify OTP · Login/Register · Confirm payment · SOS · Rate driver · Apply promo · Add stop · Cancel. Each: `disabled={pending}` via the hook.

---

## P2 — Unified errors & notifications (UX consistency)

### P2.1 Gateway structured error envelope

Add `httpx.WriteError(w, status, code, message)` → `{"success":false,"error":{"code":"…","message":"…"}}`, and `WriteJSON` for success. Replace plain-text `http.Error` on the user-facing paths (auth, booking, payment, SOS). The API clients already expect an envelope (`ApiError` reads `envelope.error`) — this makes them light up.

### P2.2 Toast in both apps

- client-app: mount a `<Toaster>` that renders `useToastStore` (the store exists, unused) — one component in the root layout.
- rider-app: add a mirror `useToastStore` + `<Toaster>`.
- Wire the API client's `catch` → `toast.show(friendly(code), 'error')`. Success paths can `toast.show(…, 'success')`.

### P2.3 Friendly message map

`code → user copy` table (e.g. `rate_limited → "Too many attempts. Try again in a few minutes."`, `outside_service_area → "Vahnly is Kolkata-only for now."`, `active_order_exists → "You already have a trip in progress."`). Default fallback for unknown codes. Single shared map per app.

### P2.4 (later) Real push

Replace `StubFCMSender` with real FCM; add rider-app FCM registration. Separate slice — not needed for in-app errors.

---

## Suggested order

1. **P0** (server limits) — small, backend-only, high security value → build + deploy alone.
2. **P2.1** (error envelope) — backend, unblocks nice client errors.
3. **P1.1 + P2.2/P2.3** (hook + toast + messages) — frontend, both apps, lands together.
4. **P1.2** (idempotency), **P2.4** (push) — follow-ups.

## Decisions to confirm (I'll default these if you don't pick)

1. **Limits** — accept the P0.2 table, or adjust the numbers?
2. **OTP fail-closed** — yes on send-otp (recommended) vs fail-open everywhere?
3. **Scope/order** — all of P0–P2 now, or P0 (security) first + deploy, then the rest?
4. **Idempotency (P1.2)** — include now or defer? (It's the real double-charge fix but a bit more work.)
