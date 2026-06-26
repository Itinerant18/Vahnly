# Rider Login — Stop Paying for OTP Every Login

Lead doc. Problem: every rider login fires a Firebase SMS (OTP) → burns gcloud credit. Goal: OTP only
when genuinely needed (register / forgot-password), never on routine login.

---

## 0. The honest diagnosis first (what's best ≠ what you'd guess)

**You already paid for most of this fix this session.** Riders are passwordless (no `password_hash`,
no password endpoint — confirmed), so historically *every* login = 1 SMS. But the **refresh tokens
shipped today** change the math:

- Rider logs in once (1 OTP) → gets a **90-day refresh token** → the rider app **silently refreshes**
  when the 72h access token expires (`/auth/refresh` RIDER branch + rider-app interceptor, both live).
- So in production a rider OTPs **~once per 90 days per device**, not per login.
- **"OTP every login" is largely a testing artifact** — you're logging out + back in repeatedly. A real
  rider who just keeps using the app won't re-OTP.

> ⚠ Caveat: only riders who log in on the **new APK** (with the refresh interceptor) get this. Verify the
> chain end-to-end on-device: firebase login → refresh token stored → close app a while → reopens without
> re-OTP. If that holds, the urgency drops sharply.

No `ACCESS_TOKEN_TTL` flip is needed for "stay logged in" — the 72h token expiring just triggers a silent
refresh.

---

## 1. The cost-optimal stack (best for the user)

SMS should fire **only** to prove phone ownership, which is genuinely needed only at **registration** and
**password reset** — never on routine login. Three levers, in order of leverage:

| # | Lever | SMS cost | Status |
| :-- | :-- | :-- | :-- |
| 1 | **Refresh tokens / stay-logged-in 90d** | ~1 OTP / 90 days / device | ✅ shipped today (verify on-device) |
| 2 | **Google login** (zero SMS, no password) | 0 | exists — just make it prominent |
| 3 | **Phone + password login** (your ask) | 0 after register | NOT built for rider — the residual |

**Recommendation:** 1 + 2 already get you to near-zero SMS in steady state. **3 is the last mile** — it
only saves SMS on a *re-login within 90 days by a non-Google user*. Worth doing (cheap), but know it's
secondary, not the fix. The fix is mostly already in the new APK.

---

## 2. Rider phone+password — the plan (if you want lever 3)

Cheap because it **mirrors the driver auth shipped this session** (bcrypt, password policy, login
rate-limit guards, forgot/reset, auto-login-on-register all already exist for the driver).

### 2.1 DB
```sql
ALTER TABLE riders ADD COLUMN password_hash text;   -- NULLABLE
```
Nullable so existing OTP-only riders aren't broken — password is optional, set at register or via a
set/forgot-password flow.

### 2.2 Backend (mirror `internal/driver/.../auth_handler.go`)
- **Register-with-password:** OTP proves phone → set password → create rider (phone_verified) →
  **auto-login** (return session + refresh, like the driver register we just shipped).
- **Login:** `POST /api/v1/rider/auth/login {phone, password}` → bcrypt verify → session + refresh
  (mirror `driverLogin`). Reuse the IP `loginGuard` rate-limit.
- **Forgot/reset:** `forgot-password` (OTP, anti-enumeration) + `reset-password` (OTP → new password →
  revoke + auto-login). Direct mirror of the driver flow.
- **Policy:** reuse `validatePasswordPolicy` (≥8, not all-numeric). It lives in the driver http package —
  move to a shared pkg or a 6-line dup; don't overthink.

### 2.3 Rider app (`rider-app`)
- **Login screen:** phone + password (primary) · "Continue with Google" (prominent, zero-SMS) · small
  "Log in with OTP instead" (fallback for password-forgetters — costs 1 SMS, their choice) · "Forgot
  password?".
- **Register:** phone → OTP (1 SMS, phone proof) → name + password → in-app.
- Store the refresh token on password-login (mirror `persistRefresh` already added).

### 2.4 Existing OTP-only riders (password_hash NULL)
They can keep using OTP/Google, or set a password via the forgot/set-password flow. No forced migration.

---

## 3. What stays on OTP (intended, minimal)
- **Registration** — 1 SMS, phone proof. Unavoidable + correct.
- **Forgot password** — 1 SMS, only when needed.
- **Optional "Login with OTP" fallback** — user's choice, rare.
Everything else (routine login, app reopen) = password / Google / silent refresh = **0 SMS**.

---

## 4. Scope — DECIDED: B  ·  ✅ SHIPPED

Built: migration `000120` (nullable `password_hash`, deploy-safe — db-migrator runs first); rider repo
scan + `SetRiderPassword`; service `LoginByPassword` / `SetPassword` / `ForgotPassword` / `ResetPassword`
(+ `MintRefresh` so password-login stays logged in 90d); routes `POST /rider/auth/login` (loginGuard),
`/forgot-password` + `/reset-password` (OTP guards), `/rider/me/password` (authed); rider login screen now
leads with **phone + password** + "Forgot password?" + "Sign up with phone (OTP)" fallback + Google.
Policy test + `go build ./...` + rider tsc green. **OTP now only at register/forgot — never routine login.**

> Deferred (tiny): an authed "Set password" in account settings (no OTP). For now the forgot-password
> flow already lets an OTP-only rider set their first password (1 OTP), then password-login forever.

### Original build order

Build order (each step verifiable; mirrors the driver auth shipped this session):
1. **Migration** `000NNN_riders_password_hash`: `ALTER TABLE riders ADD COLUMN password_hash text;`
2. **Shared password policy:** move `validatePasswordPolicy` to a shared pkg (or dup) usable by rider + driver.
3. **Rider repo:** `GetRiderByPhone` already returns the rider; add `password_hash` to the scan +
   `SetPassword(riderID, hash)`.
4. **Backend rider auth** (`internal/rider/.../auth_service.go` + handler):
   - `Register(phone, phone_token/otp, password, name)` → policy → create with hash → auto-login (session+refresh).
   - `LoginByPassword(phone, password)` → bcrypt verify → session+refresh.
   - `ForgotPassword(phone)` (OTP, anti-enumeration) + `ResetPassword(phone, otp, new_password)` (revoke + auto-login).
   - Routes: `POST /rider/auth/login`, `/rider/auth/register`, `/rider/auth/forgot-password`,
     `/rider/auth/reset-password` — behind the existing `loginGuard` / `otpSend` / `otpVerify` rate guards.
5. **Rider app:** login screen → phone+password (primary) + prominent Google + "Log in with OTP instead"
   fallback + "Forgot password?"; register → OTP → set password; store refresh on password-login.
6. **Verify:** `go build`/`go test`, `tsc`, on-device: register→logout→password-login (no SMS).

Driver side: already correct (phone+password; OTP only on the `phone_verified===false` gate, true
post-register). No driver work.

> Note: refresh-stay-logged-in (§0) still applies on top — even password-login riders rarely re-login
> within 90 days. Password just removes the SMS on the re-logins that do happen for non-Google users.
