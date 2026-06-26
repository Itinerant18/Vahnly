# Auth Hardening Plan — Login · Registration · Forgot-Password (rider + driver)

Lead doc. Grounded in current code (file:line). Status: **plan**. Goal: harden auth **and** make
login/registration feel seamless — these pull against each other, so first, the resolution.

---

## 0. The tension, and how we resolve it

"Seamless" wants long sessions + few prompts. "Hardened" wants short sessions + more checks. We get
**both** from one property the system already has:

> **A long, seamless session window + instant server-side revocability.**

Today every driver request re-checks a `jti` against Redis (`auth.go:73-75,490-502`) — so a token is
killable the moment its session row is deleted, *regardless* of its expiry. That means we can keep
sessions long (seamless) without the usual "long token = long theft window" downside, because theft is
mitigated by revocation, not by short expiry. Every choice below leans on this.

---

## 1. Current state (grounded)

**Good already:**
- HS256 JWT, secret is mandatory-on-boot (`main.go:58-61`). bcrypt passwords (driver cost 10, admin 12).
- `jti`-based session revocation for drivers (`auth.go`), instant on admin block.
- Brute-force + OTP rate limits (just shipped: P0 reliability — OTP 3/phone/hr, login 10/IP/15m, etc.).
- Driver: phone+password, Google, phone-OTP. Rider: phone-OTP + Google (passwordless). Firebase verify
  mints the platform JWT (`firebase_handler.go`).
- Driver `change-password` enforces a min length + verifies the **current** password (`driver_self_service_handler.go:661,672`).
- `DeleteAccount` already revokes the session (`:724`) — a reuse target.

**Gaps that matter for this work:**
- ❌ **No forgot/reset-password for drivers.** `change-password` needs the *old* password — useless to
  someone who forgot it. OTP-login recovers *access* but can't reset the password in one flow.
- ❌ **Single long access token** (driver 7d / rider 72h), no refresh/sliding → expiry = surprise logout.
- ❌ **No revoke-on-password-change/reset** → a reset doesn't lock out whoever had the old password.
- ❌ **No "log out all devices."** Rider sessions aren't jti-revocable (driver are).
- ⚠ **localStorage tokens.** In a **native Capacitor WebView** (assets bundled, no 3rd-party scripts)
  the XSS exposure is far lower than a public website — real but not urgent. Capacitor Preferences is better.
- ❌ **No password policy on register/reset** (min-length only exists on change-password).
- ❌ Registration bounces to login instead of dropping the user **into** the app.

---

## 2. Scope — what we harden, what we deliberately SKIP

Be opinionated for a Kolkata launch with a driver/rider audience (not an enterprise console).

**DO:** forgot/reset-password (driver) + revoke-on-reset, password policy, seamless sessions
(sliding-expiry — see §4), auto-login after register, rider jti sessions + logout-all-devices,
Capacitor secure storage, session-expiry UX, post-login deep-link.

**SKIP (over-engineering for this stage — the Explore listed them; we say no on purpose):**
driver/rider TOTP MFA (OTP is already a possession factor; TOTP is friction a Kolkata driver won't
adopt), email verification (email is optional, low value), device fingerprinting / anomaly scoring,
concurrent-session caps, JWT-secret rotation infra. Revisit post-scale.

---

## 3. P0 — Forgot / Reset password (driver) + revoke-on-reset + password policy  ✅ SHIPPED

The explicit ask, and a confirmed real gap. Reuses the existing OTP infra entirely.

**Shipped:** `POST /driver/auth/forgot-password` (anti-enumeration, always 200, reuses the OTP
rate-limit + send path, purpose=`RESET`) + `POST /driver/auth/reset-password` (verifies the RESET OTP →
`validatePasswordPolicy` → new bcrypt hash → **revokes the session** (deletes the jti key) → **auto-login**
returns a fresh JWT). Policy (≥8, not all-numeric) also enforced on register. Both routes rate-limited
(otpSend/otpVerify guards). Driver login screen gained a "Forgot password?" → phone → code + new
password → lands in-app. Policy unit test + gateway build + client tsc green.

### 3.1 Reset flow (phone is the recovery channel — no email)
```
1. Login screen → "Forgot password?" → enter phone.
2. POST /api/v1/driver/auth/forgot-password {phone}
   → rate-limited (reuse the otpSend guard) → sends the SAME 6-digit OTP (existing send-otp).
   → ALWAYS 200 (don't reveal whether the phone is registered — anti-enumeration).
3. Enter OTP + new password.
4. POST /api/v1/driver/auth/reset-password {phone, otp, new_password}
   → verify OTP (existing verify-otp path / phone_token) → enforce §3.3 policy
   → set new bcrypt hash (cost 10)
   → REVOKE ALL driver sessions for that id (§3.2)  ← the point of a reset
   → AUTO-LOGIN: issue a fresh session JWT in the response (seamless — land in the app).
```
Fallback that already exists: a driver who'd rather not reset can still **log in with OTP** (verify-otp
returns a full session for existing drivers). Reset is the first-class path; OTP-login is the backstop.

### 3.2 Revoke-on-reset / change (bundle here, not "later")
A password reset/change that leaves old tokens valid is a half-fix. On reset **and** on change-password:
delete the driver's session row(s) so every outstanding token dies, then issue one fresh token for the
acting device. Reuse the `DeleteAccount` revoke pattern (`:724`). This also delivers the security half of
"log out all devices."

### 3.3 Password policy (register + reset + change)
Minimum: **≥ 8 chars, not all-numeric, not equal to the phone number.** One shared validator
(`internal/.../password_policy.go`), applied at register, reset, change. Reject with a clear code
(`password_too_weak`) → the friendly-error map already turns codes into copy. (No max-age/rotation/history
— overkill here.)

---

## 4. P1 — Seamless sessions via refresh tokens  ·  DECIDED: Option B  ·  BACKEND SHIPPED

**Shipped (backend, default-safe):** `middleware/refresh.go` (opaque token, sha256-hashed in Redis,
`GetDel` rotation = replay-protection, `AccessTokenTTL()` env-overridable **default 7d = no behavior
change**). `POST /auth/refresh` (driver) rotates + re-mints. **All 5 driver mint sites issue a refresh
token** (password login, OTP-verify, google, reset, firebase-verify) via the shared
`issueDriverSession` helper. Builds + tests green.

**Client interceptor — SHIPPED (client-app):** `useAuthStore` gains `refreshToken` + `updateTokens`;
`request()` does single-flight refresh-on-401 → retry-once with the fresh token; all driver login paths
(password, OTP, google, reset, gate) thread + store the refresh token. End-to-end driver refresh is now
wired. **Activation:** set `ACCESS_TOKEN_TTL=30m` on the VM (env, reversible) once verified on-device —
until then 7d access = no behavior change. Rider refresh + logout-all = follow-ups.

Design:

- **Access token** ~30 min (replaces the 7d/72h token). Same `CustomClaims`, includes `jti` (the access
  jti stays Redis-checked, so an access token is *also* instantly revocable).
- **Refresh token** ~90 days: a high-entropy opaque random string (NOT a JWT). Stored **hashed** (sha256)
  in Redis keyed per session: `refresh:{role}:{userID}:{sessionID}` → {hash, expiresAt, deviceLabel}.
- **`POST /api/v1/auth/refresh`** {refresh_token} → validate (hash match + not expired + session not
  revoked) → **rotate** (issue a NEW refresh, invalidate the presented one) → return new access + new
  refresh. Rotation = theft detection: a replayed old refresh fails → revoke the whole session.
- **Client interceptor** (both apps' `request()`): on a 401, call `/auth/refresh` once, swap tokens,
  retry the original request. Guard against a **concurrent-refresh stampede** — a single in-flight refresh
  promise shared by all queued requests (one refresh, others await it).
- **Issued everywhere a session is minted**: password login, OTP verify, Google, Firebase verify,
  register (auto-login), reset (auto-login). Each returns `{access_token, refresh_token, ...}`.
- **Storage**: refresh token in Capacitor Preferences (native secure) with localStorage fallback (§5).

Race/edge handling to get right (the cost of Option B): single-flight refresh, retry-once-then-logout,
clock skew tolerance on expiry, and rotation-replay → full session revoke.

### 4.2 Rider parity + logout-all-devices
- Give **riders** the same jti-in-Redis session model drivers have (currently rider sessions aren't
  centrally revocable) → enables logout + revoke-on-anything for riders too.
- `POST /auth/logout-all` (driver + rider): delete all session rows for the user. Surface in settings as
  "Log out of all devices."

---

## 5. P2 — Seamless registration + storage + UX polish

- **Auto-login at end of registration (first-class).** The register handler issues the session JWT in its
  response so the user lands **in the app / onboarding**, never bounced to the login screen. (Driver
  register currently creates the account but the client re-logs-in — collapse that round-trip.)
- **Fewer round-trips.** Today: send-otp → verify-otp → register → (client) login. Target: send-otp →
  verify-otp(returns phone_token) → register(returns session) = 3 calls, lands in-app.
- **Capacitor Preferences for tokens** (native secure storage) instead of localStorage, with a localStorage
  fallback on web. Small wrapper; swap in `authStore` (both apps).
- **Session-expiry UX:** with Option A this mostly disappears (no surprise logout). Keep a graceful "please
  log in again" toast (infra shipped) on a true 401 instead of a silent redirect.
- **Post-login deep-link return:** stash the intended route before bouncing to login; return there after.

---

## 6. Rider — explicitly N/A and scoped

Riders are **passwordless** (OTP + Google) → **forgot-password does not apply**. Rider "seamless" =
session persistence (§4 sliding-expiry + Preferences) + fast OTP/Google + auto-create on first verify
(already the case) + auto-login after the new-rider onboarding. Don't pad this to match the driver section.

---

## 7. Per-flow target states (the "seamless" goal)

| Flow | Today | Target |
| :-- | :-- | :-- |
| **Driver login (password)** | phone+password → token; phone-verify gate on all routes | same, + sliding token (no surprise logout) + clear toast errors |
| **Driver login (OTP)** | send→verify→token | unchanged (already the recovery backstop) |
| **Driver forgot-password** | ❌ none | "Forgot?" → OTP → new password → **auto-logged-in**, all old sessions revoked |
| **Driver registration** | otp→verify→register→**re-login** | otp→verify→register→**in app** (auto-login) |
| **Rider login** | OTP / Google → token | same + persistent sliding session |
| **Both, app reopen** | token from storage; dies at expiry | token from Preferences; auto-slides; only re-login after 90d idle or explicit logout |

---

## 8. Phases & verification
1. **P0** (backend-only, deployable alone): forgot/reset endpoints + revoke-on-reset/change + password
   policy validator + tests. Then the two app login screens get a "Forgot password?" → reset UI.
2. **P1**: sliding-expiry middleware + client token-swap; rider jti sessions; logout-all. (Pick the fork.)
3. **P2**: auto-login-on-register, Preferences storage, deep-link, expiry toast.

Verify each: `go test` (handlers + policy + revoke), `tsc` both apps, and a manual reset + reopen walk-through.

## 9. Decisions — RESOLVED
1. ✅ **Session model: full refresh tokens** (Option B, §4) — access ~30m + rotated refresh ~90d.
2. ✅ **Reset auto-login: yes** — issue a session immediately after reset (§3.1).
3. ✅ **Password policy:** the §3.3 minimum (≥8 chars, not all-numeric, ≠ phone).
4. ✅ **Skip-list confirmed** (§2): no TOTP / email-verify / fingerprinting / session-caps / secret-rotation.

Plan is final. Build order: **P0** (reset-password + revoke + policy) → **P1** (refresh tokens + rider
jti sessions + logout-all) → **P2** (auto-login-on-register + Preferences + deep-link + expiry toast).
