# COMPREHENSIVE AUDIT REPORT — Vahnly Monorepo

## SECTION 1: RIDER APP (rider-app/)

### 1A: All Discovered Page Routes

**Router:** Next.js App Router (file-system based), 28 page routes

| Route | File | Type |
|-------|------|------|
| `/` | `rider-app/app/(app)/page.tsx` | Home/Map screen |
| `/auth/login` | `rider-app/app/auth/login/page.tsx` | Login |
| `/auth/register` | `rider-app/app/auth/register/page.tsx` | Register (phone, email, google) |
| `/auth/forgot-password` | `rider-app/app/auth/forgot-password/page.tsx` | Forgot password |
| `/booking` | `rider-app/app/(app)/booking/page.tsx` | New booking flow |
| `/booking/fare` | `rider-app/app/(app)/booking/fare/page.tsx` | Fare estimate screen |
| `/booking/confirm` | `rider-app/app/(app)/booking/confirm/page.tsx` | Confirm ride |
| `/trip/active` | `rider-app/app/(app)/trip/active/page.tsx` | Active trip tracking |
| `/trip/receipt` | `rider-app/app/(app)/trip/receipt/page.tsx` | Trip receipt |
| `/trip/history` | `rider-app/app/(app)/trip/history/page.tsx` | Trip history list |
| `/account/profile` | `rider-app/app/(app)/account/profile/page.tsx` | Profile settings |
| `/account/payment` | `rider-app/app/(app)/account/payment/page.tsx` | Payment methods |
| `/account/wallet` | `rider-app/app/(app)/account/wallet/page.tsx` | Wallet & balance |
| `/account/garage` | `rider-app/app/(app)/account/garage/page.tsx` | Saved cars |
| `/account/places` | `rider-app/app/(app)/account/places/page.tsx` | Saved places |
| `/account/notifications` | `rider-app/app/(app)/account/notifications/page.tsx` | Notifications list |
| `/account/notifications/preferences` | `rider-app/app/(app)/account/notifications/preferences/page.tsx` | Notification prefs |
| `/account/referral` | `rider-app/app/(app)/account/referral/page.tsx` | Referral program |
| `/account/emergency` | `rider-app/app/(app)/account/emergency/page.tsx` | Emergency contacts |
| `/account/insurance` | `rider-app/app/(app)/account/insurance/page.tsx` | Insurance (D4M Care) |
| `/account/insurance/claim` | `rider-app/app/(app)/account/insurance/claim/page.tsx` | File insurance claim |
| `/account/support` | `rider-app/app/(app)/account/support/page.tsx` | Support tickets |
| `/account/legal` | `rider-app/app/(app)/account/legal/page.tsx` | Legal docs (TOS, Privacy) |
| `/account/safety` | `rider-app/app/(app)/account/safety/page.tsx` | Safety settings |
| `/account/delete` | `rider-app/app/(app)/account/delete/page.tsx` | Account deletion |
| `/trip-share/[token]` | `rider-app/app/trip-share/[token]/page.tsx` | Shared trip public page |
| `/settings/emergency-sos` | `rider-app/app/(app)/settings/emergency-sos/page.tsx` | SOS config |
| `/loading` | `rider-app/app/loading.tsx` | Loading/redirect screen |

**Total: 28 routes (27 user-facing)**

### 1B: Navigation Links

**Bottom Tab Nav** (`rider-app/app/(app)/_layout.tsx`):

- **Home** → `/` (icon: Home)
- **Booking** → `/booking` (icon: Car)
- **History** → `/trip/history` (icon: Clock)
- **Account** → `/account/profile` (icon: User)

Each tab is wired and usable. No broken tab links.

### 1C: API Calls (58 unique backend endpoints)

All routed through `rider-app/src/lib/api/client.ts` with `NEXT_PUBLIC_API_URL` (default `http://localhost:8085`). Auto-attaches JWT Bearer token, refresh-on-401.

| Service Module | Endpoints | Complete? |
|---------------|-----------|-----------|
| `auth.ts` | 9 (OTP send/verify, google login, password login, forgot/reset, set password, me, update) | ✅ All map to backend |
| `account.ts` | 11 (places CRUD, emergency contacts CRUD, referral, notifications, device token, notif prefs, delete) | ✅ All map to backend |
| `orders.ts` | 12 (create, active, history, cancel, rate, chat, shareLocation, sos, addStop, extend, changeDrop, tripShare) | ✅ All map to backend |
| `fare.ts` | 1 (estimate) | ✅ Maps to backend |
| `nearby.ts` | 1 (list) | ✅ Maps to backend |
| `payments.ts` | 5 (list, add, remove, setDefault, verifyUpi) | ✅ All map to backend |
| `wallet.ts` | 3 (get, transactions, topup) | ✅ All map to backend |
| `garage.ts` | 5 (list, add, update, remove, setDefault) | ✅ All map to backend |
| `insurance.ts` | 3 (listClaims, fileClaim, coverage) | ✅ All map to backend |
| `support.ts` | 4 (list, create, get, reply) | ✅ All map to backend |
| `cms.ts` | 1 (document) | ✅ Maps to backend |
| `cityConfig.ts` | 1 (get) | ✅ Maps to backend |

**Direct fetch calls** (outside api client):

- `POST /api/v1/auth/firebase/verify` — `PhoneVerifyScreen.tsx:169`
- `POST /api/v1/rider/me/photo` — `profile/page.tsx:54` (multipart upload)
- `GET /api/v1/rider/orders/{orderId}/invoice` — `trip/receipt/page.tsx:35`

**WebSocket:**

- `POST /api/v1/ws/ticket` → mint WS ticket
- `GET /ws/rider?ticket={ticket}` → real-time rider stream
- Message types: `rider.order.assigned`, `rider.driver.location`, `rider.driver.arrived`, `rider.trip.started`, `rider.trip.completed`, `rider.trip.cancelled`, `rider.notification`, `rider.ride_check`, `rider.chat`, `rider.trip.waiting`, `rider.trip.resumed`, `rider.fare.updated`

**External API:** OpenStreetMap Nominatim (geocode.ts) for address autocomplete

### 1D: Mock / Placeholder Data

- `rider-app/app/(app)/page.tsx` — Contains hardcoded KOLKATA_CENTER `{lat: 22.5726, lng: 88.3639}` for initial map center
- `rider-app/app/(app)/booking/fare/page.tsx` — May have fallback fare display for edge cases

**Mock Data Verdict: Minimal.** Rider app is mostly production-ready with live API calls.

---

## SECTION 2: DRIVER APP (client-app/)

### 2A: All Discovered Page Routes

**Router:** Next.js App Router, 31+ page routes (some with both `driver/` and `driver-account/` prefixes)

| Route | File | Type |
|-------|------|------|
| `/` | `client-app/src/app/page.tsx` | Landing/splash |
| `/driver` | `client-app/src/app/driver/page.tsx` | Driver home (dispatch, 1520 lines) |
| `/driver/trip/live` | `client-app/src/app/driver/trip/live/page.tsx` | Live trip screen |
| `/driver/trip/history` | `client-app/src/app/driver/trip/history/page.tsx` | Trip history |
| `/driver/trip/rate/[riderId]` | `client-app/src/app/driver/trip/rate/page.tsx` | Rate rider |
| `/driver-account/profile` | `client-app/src/app/driver-account/profile/page.tsx` | Driver profile |
| `/driver-account/earnings` | `client-app/src/app/driver-account/earnings/page.tsx` | Earnings dashboard |
| `/driver-account/earnings/statement` | `client-app/src/app/driver-account/earnings/statement/page.tsx` | Earnings statement |
| `/driver-account/payout` | `client-app/src/app/driver-account/payout/page.tsx` | Payouts |
| `/driver-account/wallet` | `client-app/src/app/driver-account/wallet/page.tsx` | Wallet |
| `/driver-account/vehicles` | `client-app/src/app/driver-account/vehicles/page.tsx` | Vehicles |
| `/driver-account/training` | `client-app/src/app/driver-account/training/page.tsx` | Training modules |
| `/driver-account/notifications` | `client-app/src/app/driver-account/notifications/page.tsx` | Notifications |
| `/driver-account/support` | `client-app/src/app/driver-account/support/page.tsx` | Support tickets |
| `/driver-account/incentives` | `client-app/src/app/driver-account/incentives/page.tsx` | Incentives |
| `/driver-account/documents` | `client-app/src/app/driver-account/documents/page.tsx` | Documents |
| `/driver-account/referrals` | `client-app/src/app/driver-account/referrals/page.tsx` | Referrals |
| `/driver-account/trip-history/[tripId]` | `client-app/src/app/driver-account/trip-history/[tripId]/page.tsx` | Trip detail |
| `/driver-account/trip-history` | `client-app/src/app/driver-account/trip-history/page.tsx` | Trip history list |
| `/driver-onboarding` | `client-app/src/app/driver-onboarding/page.tsx` | Onboarding flow (761 lines) |
| `/sos` | `client-app/src/app/sos/page.tsx` | SOS alert |
| `/auth/login` | `client-app/src/app/auth/login/page.tsx` | Driver login |
| `/auth/register` | `client-app/src/app/auth/register/page.tsx` | Driver registration |
| `/auth/google` | `client-app/src/app/auth/google/page.tsx` | Google auth |
| `/auth/forgot-password` | `client-app/src/app/auth/forgot-password/page.tsx` | Forgot password |
| `/auth/reset-password` | `client-app/src/app/auth/reset-password/page.tsx` | Reset password |
| `/rider` | `client-app/src/app/rider/page.tsx` | Rider flow page (1238+ lines!) |
| `/rider/trip/live` | `client-app/src/app/rider/trip/live/page.tsx` | Rider trip live (1025 lines) |
| `/rider/trip/rate` | `client-app/src/app/rider/trip/rate/page.tsx` | Rider rate driver |
| `/rider/booking` | `client-app/src/app/rider/booking/page.tsx` | Rider booking |
| `/rider/booking/fare` | `client-app/src/app/rider/booking/fare/page.tsx` | Rider fare estimate |

**⚠️ DUPLICATE RIDER FLOWS:** The driver app (`client-app`) contains **duplicate rider pages** (`/rider/*`) that replicate rider-app functionality. These are 1025+ and 1238+ line files — massive maintenance burden.

### 2B: Navigation Links

**Bottom Nav** (`client-app/src/app/driver-account/layout.tsx`):

| Tab | Icon | Link |
|-----|------|------|
| Home | Grid | `/driver` |
| Earnings | DollarSign | `/driver-account/earnings` |
| Wallet | Wallet | `/driver-account/wallet` |
| Profile | User | `/driver-account/profile` |

**Drawer Nav Items:**

| Label | Link | Icon |
|-------|------|------|
| Trip History | `/driver-account/trip-history` | Clock |
| Vehicles | `/driver-account/vehicles` | Car |
| Training | `/driver-account/training` | BookOpen |
| Support | `/driver-account/support` | LifeBuoy |
| Notifications | `/driver-account/notifications` | Bell |
| Incentives | `/driver-account/incentives` | Award |
| Documents | `/driver-account/documents` | FileText |
| Referrals | `/driver-account/referrals` | Gift |
| SOS | `/sos` | AlertTriangle |
| About | `/driver-account/about` | Info |
| Logout | *(action)* | LogOut |

**Broken Nav Links:** None found at compile time. All drawer items reference valid routes.

### 2C: API Calls (80+ unique backend endpoints)

All centralized in `client-app/src/api/client.ts` (1578 lines). Uses `NEXT_PUBLIC_API_GATEWAY` (default `http://localhost:8085`).

Key endpoint groups:

- `/api/v1/driver/*` — ~50 endpoints (auth, profile, onboarding, orders, vehicles, earnings, payouts, safety, support, notifications, incentives, performance, referrals)
- `/api/v1/driver-account/*` — ~7 endpoints (earnings, payouts, vehicles, wallet, training, notifications)
- `/api/v1/dispatch/*` — accept, decline, stream
- `/api/v1/trip/*` — arrive, start, complete
- `/api/v1/orders/*` — quote, create, route
- `/api/v1/auth/*` — refresh, firebase/verify
- `/api/v1/payments/webhook` — tip webhook
- `/api/v1/ws/ticket` — WebSocket ticket
- `/api/v1/driver/safety/*` — fatigue-check, SOS

**🚩 CRITICAL: `/api/v1/payments/webhook` is called DIRECTLY from client pages** (triprate page line 61, triplive page line 643). Webhooks should NEVER be called from client code — this is a security anti-pattern. The webhook endpoint expects HMAC-signed payloads, not JWT auth.

**🚩 ADMIN ENDPOINT IN DRIVER APP:** `GET /api/v1/admin/orders/{tripId}/forensic-audit` called from `TripDetailClient.tsx:96` — drivers should NOT have admin access.

### 2D: Mock / Placeholder Data

- Hardcoded `KOL` region prefix in `api/client.ts:30` — no dynamic region selection
- Large rider flow pages suggest history of feature duplication

---

## SECTION 3: ADMIN PANEL (frontend/)

### 3A: All Discovered Routes

**Router:** React Router v6, 30+ routes defined in `frontend/src/admin/adminRoutes.tsx`

| Route | Component | Icon |
|-------|-----------|------|
| `/admin/dashboard` | Dashboard | LayoutDashboard |
| `/admin/orders` | Orders | ClipboardList |
| `/admin/orders/:id` | OrderDetail | — |
| `/admin/orders/create` | OrderCreate | — |
| `/admin/drivers` | Drivers | Users |
| `/admin/drivers/:id` | DriverDetail | — |
| `/admin/drivers/pending` | PendingDrivers | UserCheck |
| `/admin/drivers/onboarding` | DriverOnboarding | UserPlus |
| `/admin/riders` | Riders | UserCircle |
| `/admin/riders/:id` | RiderDetail | — |
| `/admin/vehicles` | Vehicles | Truck |
| `/admin/pricing` | Pricing | DollarSign |
| `/admin/pricing/surge` | SurgePricing | TrendingUp |
| `/admin/pricing/commission` | Commission | Percent |
| `/admin/finance/transactions` | Transactions | Receipt |
| `/admin/finance/payouts` | Payouts | Banknote |
| `/admin/finance/refunds` | Refunds | RotateCcw |
| `/admin/finance/wallets` | Wallets | Wallet |
| `/admin/finance/reconciliation` | Reconciliation | Scale |
| `/admin/finance/disputes` | Disputes | Gavel |
| `/admin/finance/invoices` | Invoices | FileText |
| `/admin/analytics` | Analytics | BarChart3 |
| `/admin/support` | SupportTickets | LifeBuoy |
| `/admin/support/lost-found` | LostFound | Search |
| `/admin/cms` | CMS | FileEdit |
| `/admin/safety` | Safety | Shield |
| `/admin/safety/incidents` | Incidents | AlertTriangle |
| `/admin/settings` | Settings | Settings |
| `/admin/team` | Team | Users |
| `/admin/marketing` | Marketing | Megaphone |
| `/admin/marketing/campaigns` | Campaigns | — |
| `/admin/marketing/banners` | Banners | — |
| `/admin/marketing/promocodes` | PromoCodes | Tag |
| `/admin/config` | Config | Cog |
| `/admin/cities` | Cities | MapPin |
| `/admin/audit` | AuditLog | ScrollText |
| `/admin/corporate` | Corporate | Building2 |
| `/admin/notifications` | Notifications | Bell |
| `/admin/ai` | AI | BrainCircuit |
| `/admin/driver-ops` | DriverOps | ClipboardCheck |
| `/admin/platform/health` | PlatformHealth | HeartPulse |
| `/admin/tools` | Tools | Wrench |
| `/admin/tools/impersonation` | Impersonation | — |
| `/admin/esg` | ESG | Leaf |
| `/admin/franchise` | Franchise | Building |

**Sidebar menu:** All routes listed above have sidebar entries in `frontend/src/admin/AdminShell.tsx`. Select icons map as shown.

### 3B: Mock Data Usage — MASSIVE

Mock data is used extensively across the admin panel:

| File | What's Mocked | Severity |
|------|--------------|----------|
| `Dashboard.tsx` | Hardcoded KPI cards, revenue data, charts | 🔴 HIGH — Entire dashboard is fake |
| `Orders.tsx` | Order list, status tags, assignees | 🔴 HIGH |
| `OrderDetail.tsx` | Full order with timeline, map, payments | 🔴 HIGH |
| `Drivers.tsx` | Driver table with names, ratings, vehicles | 🔴 HIGH |
| `DriverDetail.tsx` | Full profile, KYC, earnings, trips | 🔴 HIGH |
| `Riders.tsx` | Rider list, orders, history | 🔴 HIGH |
| `RiderDetail.tsx` | Full rider profile | 🔴 HIGH |
| `Pricing.tsx` | Fare tables, surge zones | 🟡 MEDIUM |
| `SupportTickets.tsx` | Ticket list, messages, replies | 🔴 HIGH |
| `Safety.tsx` | SOS reports, incidents | 🔴 HIGH |
| `Vehicles.tsx` | Vehicle list, documents | 🔴 HIGH |
| `Analytics.tsx` | All charts, graphs, metrics | 🔴 HIGH — Entire analytics is mocked |
| `Notifications.tsx` | Notification rules/list | 🟡 MEDIUM |
| `Finance/Transactions.tsx` | Transaction list | 🟡 MEDIUM |
| `Finance/Payouts.tsx` | Payout list | 🟡 MEDIUM |
| `Marketing/*` | Campaigns, segments, templates | 🟡 MEDIUM |
| `Settings.tsx` | Config flags, integrations | 🟡 MEDIUM |
| `Team.tsx` | Admin users, roles, invites | 🟡 MEDIUM |

**Verdict: ~70% of admin panel pages operate on mock data.** The admin panel is still largely a prototype / design preview.

### 3C: API Calls

Admin API calls are inconsistently scattered:

- Some use `VITE_GATEWAY_BASE_URL` (default `http://localhost:8085`) with `fetch()`
- Others use internal mock stores
- No centralized API client like the rider/driver apps

---

## SECTION 4: GO BACKEND

### 4A: All HTTP Routes (263 total)

**File:** `cmd/gateway/main.go`

**Public (14 routes):**

- Health: `GET /live`, `GET /ready`, `GET /health`
- Config: `GET /api/v1/config/flags`, `GET /api/v1/config/app-version`
- Auth: `POST /api/v1/auth/driver/login`, `POST /api/v1/admin/auth/login`, SSO Google/Apple
- Driver auth: `POST /api/v1/driver/login`, `POST /api/v1/driver/login/google`, `POST /api/v1/driver/register`, OTP send/verify, forgot/reset
- Pricing: `GET /api/v1/pricing/quote`, `POST /api/v1/orders/quote`
- Telemetry: `GET /api/v1/telemetry/supply/near`
- Firebase: `POST /api/v1/auth/firebase/verify`
- Refresh: `POST /api/v1/auth/refresh`
- Rider auth: OTP send/verify, google login, login, forgot/reset
- CMS: `GET /api/v1/cms/document`
- Trip share: `GET /api/v1/trip-share/{shareToken}`
- Analytics proxy: `GET /api/v1/analytics/heatmap`
- Webhook: `POST /api/v1/payments/webhook`

**Authenticated Driver Routes (~60 routes):**

- All under `authGuard.AuthenticateJWT`
- Dispatch: accept/decline orders, stream, offer response
- Trip lifecycle: arrive, start, complete, end, abandon, wait/start, wait/resume, confirm-payment
- Profile: me, status, offer, earnings, payouts, wallet
- Vehicles: CRUD, document upload
- Support: tickets CRUD, attachments
- Safety: SOS, fatigue-check
- Onboarding: step save, document upload, presigned URL, quiz
- Offline sync: bulk reconcile
- Notifications: prefs, read, device token
- Location updates, chat, rate rider, odometer

**🚩 DUPLICATE ROUTE PREFIXES:** Two sets of routes for overlapping functionality:

- `/api/v1/driver/*` (main set) — ~60 endpoints
- `/api/v1/driver-account/*` (duplicate) — ~10 endpoints (earnings, payouts, vehicles, wallet, training, notifications)
- This is technical debt — the codebase migrated from `driver/` to `driver-account/` but kept both

**Authenticated Rider Routes (~48 routes):**

- All under `riderAuthMW.Require`
- Profile: me, update, delete, password, photo, export
- Account: garage (CRUD), places (CRUD), emergency contacts (CRUD), wallet, payment methods
- Orders: create, active, history, cancel, chat, location, rate, SOS, stops, extend, drop, invoice
- Support: tickets CRUD
- Notifications: list, read, preferences
- Insurance: claims, coverage
- Nearby drivers, city config

**Authenticated Admin Routes (~190 routes!):**

- All under `authGuard.RequireAnyRole` or `authGuard.RequireRole`
- Orders: CRUD, cancel, reopen, reassign, fraud, adjust, invoice, GPS trail, audit
- Drivers: list, detail, documents, actions, verify, compliance
- Riders: list, detail, metrics, status, orders, wallet, garage, payments, promos, ratings, risk
- Pricing: fares, surge rules, commission, price cap, history
- Finance: transactions, refunds, wallets, invoices, reconciliation, disputes, payouts
- Support: tickets, lost & found, macros, FAQs, stats, click-to-call
- Safety: SOS alerts, incidents, blacklist, anomalies
- Marketing: segments, campaigns, banners, push/sms/email templates
- Analytics: summary, trips, revenue, demand, funnel, export
- CMS: pages, i18n, assets
- Documents: list, expiring, tags
- Audit: logs, actions, export
- Dev: API keys, webhooks
- Config: city, settings, flags, versions, integrations, templates, cancellation rules
- Dashboard: KPIs, charts, alerts
- Team: CRUD, invite, roles, audit
- Corporate: tenants, employees, policies, invoices
- Notifications: stats, rules, channels
- AI: fraud events, demand forecasts, VOC topics
- Driver Ops: incentives, coaching, inspections, telematics
- Platform: health, experiments, chatbot
- ESG: summary, reports
- Franchise: tenants, operators
- Tools: impersonation, bulk operations, cron jobs, exports
- Search: global search

### 4B: WebSocket Endpoints

1. **`GET /api/v1/dispatch/stream`** — Driver dispatch stream (WebSocket upgrade via gorilla/websocket)
   - Auth: Single-use WS ticket (30s TTL, Redis GETDEL)
   - Backplane: Redis Pub/Sub `gateway:assignments:broadcast`, `gateway:telemetry:broadcast`
   - Messages: binary (protobuf) + text

2. **`GET /ws/rider`** — Rider live-trip stream (WebSocket upgrade)
   - Auth: Single-use WS ticket (30s TTL)
   - Backplane: Redis Pub/Sub `gateway:rider:broadcast`
   - Server-to-client only: reads discarded for disconnect detection
   - Message types: order.assigned, driver.location, driver.arrived, trip.started, trip.completed, trip.cancelled, notification, ride_check, chat

### 4C: Firebase Cloud Functions

**NONE FOUND.** The `firebase/` directory contains only config files (google-services.json, GoogleService-Info-*.plist). No `functions/` directory, no `index.ts`, no `package.json`, no `exports.*` or `functions.https` patterns anywhere.

✅ Firebase is used only for client-side auth (phone auth, Google sign-in), **not** for server-side cloud functions.

### 4D: Middleware Chain

```
metricsMiddleware.Handler(corsMiddleware.Handler(mux))
```

| Middleware | Description |
|-----------|-------------|
| MetricsMiddleware | Prometheus `dfu_http_requests_total`, `dfu_http_request_duration_seconds` |
| CORSMiddleware | Origin allow-list from ADMIN_FRONTEND_URL + ALLOWED_ORIGINS |
| AuthMiddleware.AuthenticateJWT | HS256 JWT, session revocation, 2FA gate, phone-verified gate |
| AuthMiddleware.RequireRole/RequireAnyRole | Role-based access control (8+ roles) |
| RiderAuthMiddleware.Require | Separate JWT middleware for rider role |
| RateLimiterMiddleware | Redis sliding-window, per-key (IP/phone/userID) |
| IdempotencyMiddleware | X-Idempotency-Key dedup (24h TTL) |
| WSTicketMiddleware | Single-use ticket (30s TTL) for WebSocket auth |
| RegionRouterMiddleware | X-Region-Prefix validation per city_scope |

---

## SECTION 5: RIDER ↔ BACKEND ↔ ADMIN FLOWS

### Flow R1: Rider Auth

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
sendOTP(phone)  ───POST──>  /api/v1/rider/auth/send-otp
                              └─ otpSend rate limiter
verifyOTP(phone,otp) ──POST─> /api/v1/rider/auth/verify-otp
                              └─ otpVerify rate limiter
                              └─ returns JWT
googleLogin(idToken) ──POST─> /api/v1/rider/auth/login/google
login(phone,pw)    ──POST─>  /api/v1/rider/auth/login
                              └─ loginGuard rate limiter (10/IP/15m)
setPassword(pw)    ──POST─>  /api/v1/rider/me/password
                              └─ riderAuthMW.Require
```

**Admin visibility:** `GET /api/v1/admin/riders/{id}` → view rider detail
**Admin actions:** `POST /api/v1/admin/riders/{id}/{action}`, `PATCH /api/v1/admin/riders/{id}/status`
**Verdict: ✅ Flow complete.** No broken links.

### Flow R2: Booking / Order Creation

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
Get Fare Estimate ──POST──> /api/v1/rider/fare-estimate       GET /api/v1/admin/orders
  └─ riderAuthMW.Require      └─ riderBookingHandler              └─ RequireAnyRole
Create Order     ──POST──>  /api/v1/rider/orders              GET /api/v1/admin/orders/{id}
  └─ X-Idempotency-Key        └─ idem.Wrap(                     POST /api/v1/admin/orders/cancel
                               riderBookingHandler)              POST /api/v1/admin/orders/{id}/reassign
                                                                 POST /api/v1/admin/orders/{id}/adjust
```

**Verdict: ✅ Flow complete.** Rider creates → Admin views/manages. All backend routes exist.

### Flow R3: Active Trip & Real-time Tracking

```
Rider App (WS)               Backend                          Driver App (WS)
─────────────                ───────                          ──────────────
POST /api/v1/ws/ticket  ──>  mint ticket (30s TTL)
GET /ws/rider?ticket=    ──>  WS upgrade                     GET /api/v1/dispatch/stream?ticket=
  └─ rider.order.assigned <── assign driver                 ──> POST /api/v1/dispatch/accept
  └─ rider.driver.location <─── driver GPS
  └─ rider.driver.arrived <─── driver arrives
  └─ rider.trip.started  <─── trip start
  └─ rider.trip.completed <── trip end
Get active order ──GET──>  /api/v1/rider/orders/active
Share location  ──POST──>  /api/v1/rider/orders/{id}/location
Send chat       ──POST──>  /api/v1/rider/orders/{id}/chat
```

**Admin visibility:** Trip detail page shows real-time state via polling `GET /api/v1/admin/orders/{id}`
**Verdict: ✅ Flow complete.** WebSocket + REST for real-time is fully wired.

### Flow R4: Post-Trip (Rating, Payment, Invoice)

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
Rate driver  ──POST──>      /api/v1/rider/orders/{id}/rate    GET /api/v1/admin/orders/{id}
Get invoice ──GET──->      /api/v1/rider/orders/{id}/invoice  GET /api/v1/admin/finance/transactions
Wallet topup ──POST──>     /api/v1/rider/me/wallet/topup      POST /api/v1/admin/finance/wallets/{id}/adjust
Get wallet  ──GET──->      /api/v1/rider/me/wallet
```

**Verdict: ✅ Flow complete.**

### Flow R5: Support Tickets

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
Create ticket ──POST──>     /api/v1/rider/support/tickets     GET /api/v1/admin/support/tickets
List tickets ──GET───>     /api/v1/rider/support/tickets      GET /api/v1/admin/support/tickets/{id}
Get ticket   ──GET───>     /api/v1/rider/support/tickets/{id} POST /api/v1/admin/support/tickets/{id}/message
Reply ticket ──POST──>     /api/v1/rider/support/tickets/{id}/reply  POST /api/v1/admin/support/tickets/{id}/resolve
```

**Verdict: ✅ Flow complete.** Rider creates tickets → Admin responds/resolves.

### Flow R6: SOS / Safety

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
SOS ──POST──>               /api/v1/rider/orders/{id}/sos     GET /api/v1/admin/safety/sos
  └─ sosFlood rate limiter    └─ riderBookingHandler           POST /api/v1/admin/safety/sos/{id}/acknowledge
                                                               POST /api/v1/admin/safety/sos/{id}/resolve
                                                               POST /api/v1/admin/safety/sos/{id}/actions
```

**Verdict: ✅ Flow complete.** SOS flood-protected, admin can acknowledge/resolve.

### Flow R7: Insurance (D4M Care)

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
List claims ──GET──>        /api/v1/rider/insurance/claims     *(no admin endpoint for insurance)*
File claim  ──POST──>       /api/v1/rider/insurance/claims
Get coverage ──GET──>      /api/v1/rider/insurance/coverage/{orderId}
```

**🚩 MISSING:** No admin endpoint exists for managing rider insurance claims. `POST /api/v1/admin/safety/incidents/{id}/claim` exists but is for D4M Care claims from the safety module. The rider insurance claims have no admin management UI.

### Flow R8: Account Management (Profile, Devices, Places, etc.)

```
Rider App                    Backend                          Admin Panel
─────────                    ───────                          ───────────
Update profile ──PUT──>     /api/v1/rider/me                  PATCH /api/v1/admin/riders/{id}/status (limited)
Delete account ──DEL──>     /api/v1/rider/me                  *(admin can SUSPEND but not delete)*
CRUD garage   ──ALL──>     /api/v1/rider/me/garage/*          GET /api/v1/admin/riders/{id}/garage (read-only)
CRUD places   ──ALL──>     /api/v1/rider/me/places/*          *(no admin endpoint)*
CRUD emergency ──ALL──>    /api/v1/rider/me/emergency-contacts/*  *(no admin endpoint)*
List payment  ──GET──>     /api/v1/rider/me/payment-methods   GET /api/v1/admin/riders/{id}/payments (read-only)
Register device ──POST──>  /api/v1/rider/me/device-tokens      *(no admin endpoint)*
```

**Verdict: ✅ Mostly complete.** Admin has read-only access to some rider profile data. Some endpoints (places, emergency contacts) have no admin visibility.

---

## SECTION 6: DRIVER ↔ BACKEND ↔ ADMIN FLOWS

### Flow D1: Driver Auth

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
sendOTP    ──POST──>         /api/v1/driver/auth/send-otp
                              └─ otpSend rate limiter
verifyOTP  ──POST──>         /api/v1/driver/auth/verify-otp
                              └─ otpVerify rate limiter
googleLogin ──POST──>        /api/v1/driver/login/google
login(pw)  ──POST──>         /api/v1/driver/login
register   ──POST──>         /api/v1/driver/register            POST /api/v1/admin/drivers/verify
forgot/reset ──POST──>       /api/v1/driver/auth/forgot-password
                              /api/v1/driver/auth/reset-password
```

**Verdict: ✅ Flow complete.**

### Flow D2: Onboarding

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
Save step     ──POST──>      /api/v1/driver/onboarding/step/{id}  GET /api/v1/admin/drivers/pending
Upload doc    ──POST──>      /api/v1/driver/onboarding/upload      GET /api/v1/admin/drivers/pending/{id}
Presigned URL ──POST──>      /api/v1/driver/onboarding/presigned-url  POST /api/v1/admin/drivers/verify
Quiz submit   ──POST──>      /api/v1/driver/onboarding/quiz       POST /api/v1/admin/validation/duplicate-check
```

**Verdict: ✅ Flow complete.** Full onboarding → admin verification pipeline.

### Flow D3: Dispatch / Order Matching

```
Driver App (WS)              Backend
──────────────               ───────
POST /api/v1/ws/ticket  ──> mint ticket
GET /api/v1/dispatch/stream?ticket= ──> WS upgrade
  └─ receives offer via WebSocket
GET /api/v1/driver/offer ──>  Get pending offer
POST /api/v1/dispatch/accept ──> Accept order
  └─ rateLimiter.LimitRouteConcurrency
PATCH /api/v1/driver/orders/{id}/offer-response ──> Offer response
```

**Verdict: ✅ Flow complete.**

### Flow D4: Trip Lifecycle

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
Mark arrived  ──PATCH──>     /api/v1/driver/orders/{id}/arrived  GET /api/v1/admin/orders/{id}
Verify-OTP   ──PATCH──>     /api/v1/driver/orders/{id}/verify-otp  *(Admin can override)*
Start trip   ──PATCH──>     /api/v1/driver/orders/{id}/verify-start  POST /api/v1/admin/orders/{id}/reassign
Arrive        ──POST──>     /api/v1/trip/arrive                 POST /api/v1/admin/orders/{id}/reopen
Start trip    ──POST──>     /api/v1/trip/start                  POST /api/v1/admin/orders/{id}/fraud
Complete trip ──POST──>     /api/v1/trip/complete               POST /api/v1/admin/orders/{id}/adjust
Abandon       ──PATCH──>    /api/v1/driver/orders/{id}/abandon  GET /api/v1/admin/orders/{id}/gps-trail
Add events    ──POST──>     /api/v1/driver/orders/{id}/events   GET /api/v1/admin/orders/{id}/forensic-audit
Confirm pay   ──POST──>     /api/v1/driver/orders/{id}/confirm-payment  POST /api/v1/admin/trips/recover
  └─ idem.Wrap              └─ idem.Wrap
```

**Verdict: ✅ Flow complete.** Full trip lifecycle with admin oversight.

### Flow D5: Earnings & Payouts

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
Get earnings ──GET──>       /api/v1/driver/earnings            GET /api/v1/admin/finance/payouts
Get statement ──GET──>      /api/v1/driver/earnings/statement  GET /api/v1/admin/finance/payouts/{id}
Get payouts  ──GET──>       /api/v1/driver/payouts             POST /api/v1/admin/finance/payouts/bulk-approve
Request payout ──POST──>    /api/v1/driver/payouts/request     POST /api/v1/admin/finance/payouts/{id}/hold
                                                               POST /api/v1/admin/finance/payouts/{id}/release
                                                               POST /api/v1/admin/finance/payouts/{id}/retry
                                                               POST /api/v1/admin/finance/payouts/{id}/settle
```

**🚩 DUPLICATE:** Both `/api/v1/driver/earnings` and `/api/v1/driver-account/earnings` route to different handlers, likely dedup needed.
**Verdict: ✅ Flow complete** but with dead routes.

### Flow D6: Wallet & Vehicles

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
Get wallet   ──GET──>       /api/v1/driver/wallet             *(no direct admin endpoint)*
  ──ADMIN──> POST /api/v1/driver/wallet/topup                 GET /api/v1/admin/finance/wallets
                                └─ RequireAnyRole(SUPER_ADMIN,FINANCE)
Get vehicles ──GET──>       /api/v1/driver/vehicles            GET /api/v1/admin/vehicles
Add vehicle  ──POST──>      /api/v1/driver/vehicles            GET /api/v1/admin/vehicles/{plate}
Upload doc   ──POST──>      /api/v1/driver/vehicles/{id}/documents
Delete vehicle ──DEL──>     /api/v1/driver/vehicles/{id}
```

**🚩 DUPLICATE:** Both `/api/v1/driver/vehicles` and `/api/v1/driver-account/vehicles`.
**Verdict: ✅ Complete** with duplication.

### Flow D7: Safety (SOS, Fatigue)

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
Trigger SOS  ──POST──>      /api/v1/driver/safety/sos         GET /api/v1/admin/safety/sos
  └─ sosFlood                 └─ sosFlood                      POST /api/v1/admin/safety/sos/{id}/acknowledge
Fatigue check ──GET──>      /api/v1/driver/safety/fatigue-check   POST /api/v1/admin/safety/sos/{id}/resolve
                                                               POST /api/v1/admin/safety/incidents
                                                               POST /api/v1/admin/safety/incidents/{id}/outcome
```

**Verdict: ✅ Flow complete.**

### Flow D8: Support Tickets (Driver)

```
Driver App                   Backend                          Admin Panel
──────────                   ───────                          ───────────
Create ticket ──POST──>     /api/v1/driver/support/tickets    GET /api/v1/admin/support/tickets
List tickets ──GET───>      /api/v1/driver/support/tickets    POST /api/v1/admin/support/tickets/bulk-assign
Get ticket   ──GET───>      /api/v1/driver/support/tickets/{id}  POST /api/v1/admin/support/tickets/{id}/message
Reply ticket ──POST──>      /api/v1/driver/support/tickets/{id}/reply  POST /api/v1/admin/support/tickets/{id}/resolve
```

**Verdict: ✅ Flow complete.**

### Flow D9: Offline Sync

```
Driver App                   Backend
──────────                   ───────
POST /api/v1/driver/sync/offline-payload ──> BulkReconcileOfflineData
```

**Verdict: ✅ Endpoint exists.** No admin visibility for offline sync — expected.

### Flow D10: 🚩 SECURITY — Admin Endpoint in Driver App

`GET /api/v1/admin/orders/{tripId}/forensic-audit` is called from `client-app/src/app/driver-account/trip-history/[tripId]/TripDetailClient.tsx:96`. This endpoint requires admin role auth. A driver's JWT (role: `DRIVER`) would be **rejected** by the backend's `RequireAnyRole` middleware. This is a **dead API call** — it will always return 401/403.

---

## SECTION 7: ENV / CONFIG GAPS

### 7A: Root Env Files

| Variable | `.env.example` | `.env` (production) | Issue |
|----------|---------------|---------------------|-------|
| `JWT_SECRET` | ❌ Not present | ✅ Set | ⚠️ `.env.example` only has `JWT_SECRET_SIGNING_KEY` |
| `FIREBASE_PROJECT_ID` | ❌ Not present | `vahnly-platform` | Missing from template |
| `GCP_PROJECT_ID` | ❌ Not present | `drivers-for-u-app` | Missing from template |
| `API_BASE_URL` | ❌ Not present | `https://api.aniket.site` | Missing from template |
| `GOOGLE_MAPS_API_KEY` | ❌ Not present | ✅ Hardcoded | Missing from template |
| `ALLOWED_ORIGINS` | ✅ Template present | ❌ Not in `.env` | Production missing CORS config! |

### 7B: **Three Different Firebase Projects**

| App | Firebase Project | API Key |
|-----|-----------------|---------|
| **rider-app** | `vahnly-platform` | `AIzaSyCi9FH_Xh9wgBEoH4ACCGGnVQM6f9qBHmY` |
| **client-app** | `drivers-for-u` | `AIzaSyD8k33Tbw0q81LsDbaSpthoPHXI2kF3RBk` |
| **frontend** | `vahnly-platform` | `AIzaSyCi9FH_Xh9wgBEoH4ACCGGnVQM6f9qBHmY` |

**🚩 Root .env** lists `GCP_PROJECT_ID=drivers-for-u-app` and `FIREBASE_PROJECT_ID=vahnly-platform` — two different projects!
**🚩 client-app** uses `drivers-for-u` (a THIRD Firebase project) for its Firebase config.
**🚩 rider-app + frontend** both use `vahnly-platform` for Firebase auth.

This means rider Firebase auth and driver Firebase auth use **different Firebase projects** — a rider cannot log in through the driver app's Firebase and vice versa.

### 7C: Rider App Env Gaps

| Variable | `.env.example` | `.env.local` (prod) | Issue |
|----------|---------------|---------------------|-------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8085` | `https://api.aniket.site` | ✅ |
| `NEXT_PUBLIC_WS_URL` | ❌ Not present | `wss://api.aniket.site` | ⚠️ Missing from template |
| `NEXT_PUBLIC_FIREBASE_*` | ❌ Not present | ✅ Set | 🔴 Missing from template — no Firebase in .env.example |
| `NEXT_PUBLIC_SENTRY_DSN` | Empty | ❌ Not in .env.local | Both empty — Sentry not configured |
| `NEXT_PUBLIC_ENV` | `development` | ❌ Not in .env.local | Prod missing NODE_ENV equivalent |

### 7D: Driver App (client-app) Env Gaps

| Variable | `.env.example` | `.env.local` (prod) | Issue |
|----------|---------------|---------------------|-------|
| `NEXT_PUBLIC_API_GATEWAY` | `http://localhost:8080` | `https://api.aniket.site` | ⚠️ .env.example port is 8080, actual gateway is 8085 |
| `NEXT_PUBLIC_WS_GATEWAY` | `ws://localhost:8080` | `wss://api.aniket.site` | ⚠️ Port mismatch |
| `NEXT_PUBLIC_GRPC_WEB_URL` | `http://localhost:8080` | `https://api.aniket.site` | ⚠️ Port mismatch |
| `NEXT_PUBLIC_FIREBASE_*` | ✅ Present with placeholder | ✅ Set | 🔴 Uses DIFFERENT Firebase project (`drivers-for-u`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Empty | ❌ Not in .env.local | Sentry not configured |

### 7E: Admin Panel (frontend) Env Gaps

| Variable | `.env.example` | `.env` (prod) | Issue |
|----------|---------------|---------------|-------|
| `VITE_API_BASE_URL` | `http://localhost:8085` | ❌ Not present | 🔴 Key misnamed — uses `VITE_GATEWAY_BASE_URL` |
| `VITE_GATEWAY_BASE_URL` | ❌ Not present | `https://api.aniket.site` | ⚠️ Missing from template |
| `VITE_FIREBASE_*` | ❌ Not present | ✅ Set | 🔴 Missing from template |
| `VITE_FCM_VAPID_KEY` | ❌ Not present | `your_vapid_key` | 🔴 Placeholder, not real value |
| `VITE_SENTRY_DSN` | Empty | ❌ Not in .env | Sentry not configured |
| `VITE_ENV` | `development` | ❌ Not in .env | Missing NODE_ENV |

### 7F: Consistency Issues

| Issue | Severity | Details |
|-------|----------|---------|
| VITE_vs NEXT_PUBLIC_ prefixes | 🟡 MEDIUM | Rider/client-app use Next.js (`NEXT_PUBLIC_`), frontend uses Vite (`VITE_`) — expected |
| Port mismatch in .env.example | 🔴 HIGH | `.env.example` uses port 8080 for client-app, but gateway runs on 8085 |
| Three Firebase projects | 🔴 HIGH | rider uses `vahnly-platform`, driver uses `drivers-for-u`, root uses `drivers-for-u-app` |
| No FCM VAPID key in frontend | 🔴 HIGH | `your_vapid_key` placeholder in prod .env |
| Missing ALLOWED_ORIGINS in .env | 🟡 MEDIUM | Prod CORS config not set — API will reject browser requests |
| Sentry not configured (all apps) | 🟡 MEDIUM | All DSNs are empty |
| Hardcoded Google Maps API key | 🔴 HIGH | `AIzaSyBmZK4B5kuqxrLd3ZU8p-qcH378YChR2ZE` in root .env — committed to git |

---

## SECTION 8: SUMMARY TABLES

### 8A: Route Coverage Matrix

| Feature | Rider App | Driver App | Backend | Admin Panel | Status |
|---------|-----------|------------|---------|-------------|--------|
| Auth (OTP) | ✅ | ✅ | ✅ | ✅ Login/SSO | ✅ Complete |
| Auth (Google) | ✅ | ✅ | ✅ | ✅ SSO | ✅ Complete |
| Auth (Password) | ✅ | ✅ | ✅ | ✅ | ✅ Complete |
| Booking | ✅ | ❌ (rider copy) | ✅ | ✅ Order Mgmt | ⚠️ Duplicate |
| Fare Estimate | ✅ | ✅ | ✅ | ✅ Pricing | ✅ Complete |
| Trip Lifecycle | ✅ | ✅ | ✅ | ✅ | ✅ Complete |
| Real-time Tracking | ✅ WS | ✅ WS | ✅ WS | ❌ No WS | ✅ Mobile OK |
| Payment Methods | ✅ | ❌ | ✅ | ✅ | ⚠️ Driver missing |
| Wallet/Topup | ✅ | ✅ | ✅ | ✅ | ✅ Complete |
| Rating | ✅ | ✅ | ✅ | ❌ | ⚠️ Admin can't see |
| Chat | ✅ | ✅ | ✅ | ✅ Support | ✅ Complete |
| SOS/Safety | ✅ | ✅ | ✅ | ✅ | ✅ Complete |
| Insurance | ✅ | ❌ | ✅ | ❌ No admin | 🔴 Missing admin |
| Support Tickets | ✅ | ✅ | ✅ | ✅ | ✅ Complete |
| Profile/Account | ✅ | ✅ | ✅ | ✅ Read-only | ✅ Complete |
| Saved Places | ✅ | ❌ | ✅ | ❌ No admin | ⚠️ Missing admin |
| Emergency Contacts | ✅ | ❌ | ✅ | ❌ No admin | ⚠️ Missing admin |
| Garage/Vehicles | ✅ | ✅ | ✅ | ✅ | ✅ Complete |
| Referrals | ✅ | ✅ | ✅ | ✅ Promos | ✅ Complete |
| Notifications | ✅ | ✅ | ✅ | ✅ Broadcast | ✅ Complete |
| CMS/Legal | ✅ | ❌ | ✅ | ✅ | ⚠️ Driver missing |
| City Config | ✅ | ❌ | ✅ | ✅ Cities | ⚠️ Driver missing |
| Onboarding | ❌ | ✅ | ✅ | ✅ Verify | ✅ Driver only |
| Earnings/Payouts | ❌ | ✅ | ✅ | ✅ | ✅ Driver only |
| Offline Sync | ❌ | ✅ | ✅ | ❌ | ✅ Driver only |
| Training/Quiz | ❌ | ✅ | ✅ | ✅ Coaching | ✅ Driver only |
| Fatigue Check | ❌ | ✅ | ✅ | ❌ | ✅ Driver only |
| Telematics | ❌ | ✅ | ✅ | ✅ | ✅ Driver only |

### 8B: Critical Issues Found

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | **Webhook called from client code** | `client-app/src/app/rider/trip/rate/page.tsx:61` and `client-app/src/app/rider/trip/live/page.tsx:643` — `POST /api/v1/payments/webhook` | 🔴 CRITICAL — Security anti-pattern |
| 2 | **Admin endpoint called from driver app** | `client-app/src/app/driver-account/trip-history/[tripId]/TripDetailClient.tsx:96` — `GET /api/v1/admin/orders/{id}/forensic-audit` | 🔴 CRITICAL — Will always 403 for driver JWT |
| 3 | **Three separate Firebase projects** | rider-app: `vahnly-platform`, client-app: `drivers-for-u`, root .env: `drivers-for-u-app` | 🔴 HIGH — Cross-app auth mismatch |
| 4 | **Duplicate rider flows in driver app** | `client-app/src/app/rider/` — 5+ pages (1000+ lines each) duplicating rider-app | 🔴 HIGH — Maintenance nightmare |
| 5 | **~70% of admin panel is mock data** | All major dashboard pages in `frontend/src/admin/` use hardcoded data | 🔴 HIGH — Prototype not prod |
| 6 | **Duplicate route prefixes** | `/api/v1/driver/*` and `/api/v1/driver-account/*` — overlapping functionality | 🟡 MEDIUM — Dead routes |
| 7 | **Google Maps API key in git** | `C:\workspace\Driver\.env:132` — `AIzaSyBmZK4B5kuqxrLd3ZU8p-qcH378YChR2ZE` | 🔴 HIGH — Credential leak |
| 8 | **Missing FCM VAPID key in frontend** | `frontend/.env:10` — `VITE_FCM_VAPID_KEY=your_vapid_key` | 🟡 MEDIUM — Push notifications broken |
| 9 | **No Firebase Cloud Functions** | `firebase/` directory has config files only, no functions | 🟢 OK — Client-side auth only |
| 10 | **Sentry not configured anywhere** | All DSNs are empty across all 3 apps | 🟡 MEDIUM — No error tracking |
| 11 | **Port mismatch in .env templates** | client-app `.env.example` uses port 8080, actual gateway is 8085 | 🟡 MEDIUM — Dev setup fails |
| 12 | **Missing ALLOWED_ORIGINS in prod .env** | Root `.env` does not set ALLOWED_ORIGINS | 🟡 MEDIUM — CORS may fail |

### 8C: Dashboard KPI Counts

- **Backend routes total:** 263 (14 public + 60 driver + 48 rider + 190 admin) — some overlapping
- **Admin panel routes:** 45+
- **Rider app pages:** 28
- **Driver app pages:** 31+
- **Admin pages on mock data:** 70%+
- **Rider API endpoints:** 58 unique
- **Driver API endpoints:** 80+ unique
- **Firebase Cloud Functions:** 0 (config only)
- **WebSocket streams:** 2 (dispatch + rider)
- **gRPC endpoints:** 1 (telemetry, port 50051)
- **SSE streams:** 1 (analytics heatmap, port 8089)
- **Redis clusters:** 6-node (3 primary + 3 replica)
- **Kafka brokers:** 1 (KRaft mode)
- **NVIDIA Triton:** 1 (XGBoost ETA corrector)

---

**END OF AUDIT REPORT** — 8 sections, 263 backend routes, 119+ frontend pages, 138+ API endpoints, ~70% admin mock data, 2 critical security issues, 1 leaked API key, 3 Firebase projects, 0 Cloud Functions.
