# Claim-by-Claim Validation Matrix: DRIVER_APP_REDESIGN_PLAN.md (2026-07-09)

- **Audit Target:** `DOC/DRIVER_APP_REDESIGN_PLAN.md` (authored 2026-07-09)
- **Evaluation Date:** 2026-11-12
- **Auditors:** Principal Software Architect, Senior Mobile Product Architect, Full-Stack Lead, QA Lead
- **Evaluation Baseline:** Current repository state across `client-app/`, `workers/api/`, `workers/cron/`, `database/migrations/`, `DOC/ADR-cloudflare-migration.md`, and `DOC/DRIVER_APP_OPEN_ISSUES.md`.

---

## 1. Executive Evaluation Verdict

The original `DOC/DRIVER_APP_REDESIGN_PLAN.md` (dated 2026-07-09) provided an aesthetically strong vision for modernizing the Vahanly driver frontend around the Aura design system and a standard 4-tab bottom navigation model. 

However, **the plan has been severely invalidated by architectural evolution, premature assumptions of backend readiness, and critical workflow blind spots:**

1. **Foundational Architecture Invalidation:** The plan was written under the assumption of a monolithic Go gateway running on a GCP VM with Docker Compose, local Kafka, local Redis, and an OSRM container (`DOC/DRIVER_APP_REDESIGN_PLAN.md#L118-L123`). On 2026-09-29, the entire platform executed an architectural cutover (`DOC/ADR-cloudflare-migration.md`) to a **Cloudflare-only serverless edge deployment** (`workers/api`, `workers/cron`, SQLite Durable Objects, Neon Postgres, Cloudflare R2, Cloudflare Queues). The plan's infrastructure recommendations are completely obsolete.
2. **The "60+ Routes" Fallacy:** The plan stated that the backend surface was already broad ("60+ driver routes already existing in Go") and that only ~5 new endpoints were needed (`DOC/DRIVER_APP_REDESIGN_PLAN.md#L86-L99`). In reality, when `workers/api/src/routes/driver.ts` was implemented, it ported only ~12 routes, completely omitting core driver dispatch, offer acceptance, in-trip events, trip history, and KYC upload endpoints.
3. **Broken Core Workflows:** While the frontend built out sophisticated UI screens for many plan items, critical operational flows (such as accepting an incoming dispatch offer or recording toll/parking charges) 404 against the active edge backend.
4. **Information Architecture Divergence:** The plan proposed a 4-tab structure with Tab 2 as "Trips" (`/driver/trips`, supporting upcoming scheduled bookings and history). The implementation diverged: `TabBarRedesign.tsx` created a "Jobs" tab (`/driver/jobs`) that only displays past completed trips, leaving the upcoming scheduled booking UI orphaned in `/driver/trips` on an older, unlinked component.

---

## 2. Validation Status Taxonomy

Every claim and requirement in the plan is evaluated against the current repository using the following standardized statuses:
- **Verified Complete:** Functionality is implemented end-to-end (UI, API, persistence, events) and validated in code.
- **Implemented, Runtime Unverified:** End-to-end code paths exist, but runtime verification under live load/services was not performed.
- **Partially Implemented:** Substantial code exists in one or more layers, but key integration points or fields are missing.
- **UI Only:** Visual components or screens exist, but they are backed by local mocks, hardcoded timeouts, or unconnected stubs.
- **Backend Only:** Endpoints, schema, or worker jobs exist, but no driver-facing UI connects to them.
- **Mock / Stub:** Component or endpoint exists solely as a hardcoded static return or fake simulation.
- **Missing After Scoped Inspection:** Requirement described in the plan was not found in the codebase.
- **Defective:** Code exists but fails, crashes, contains security vulnerabilities, or exhibits logic inversions.
- **Superseded:** Architectural changes (e.g., Cloudflare migration) made the requirement or assumption obsolete.
- **Not Applicable:** Item is not relevant to the rider-owns-car driver-on-hire domain model.

---

## 3. Claim-by-Claim Validation Matrix

| Plan Section | Claim / Proposed Requirement | Current Repository Implementation | Code Evidence (File & Line) | Status | Remaining Work / Gap | Dependencies | Confidence |
|:---|:---|:---|:---|:---:|:---|:---|:---:|
| **§0 Goal** | Rebuild `client-app/` as mobile-responsive driver product on Aura tokens (forest/sage, Playfair) | Aura CSS variables defined; tokens used across most components; Playfair font configured. | `client-app/src/app/globals.css#L1-L120`, `client-app/src/components/ds/` | **Verified Complete** | None for token layer; styling consistency pass needed on legacy modals. | None | High |
| **§0 Goal** | Backend work needed so every screen runs on live data | `workers/api/src/routes/driver.ts` implements only ~12 routes. Stats, earnings, and KYC are hardcoded or 404. | `workers/api/src/routes/driver.ts#L104-L115,L221-L228` | **Defective** / **Partially Implemented** | Port missing endpoints from legacy Go to Hono; replace mock returns with SQL queries. | Neon DB, `workers/api` | High |
| **§1 Category** | Bottom tab bar, not a drawer (Home, Trips, Earnings, Account) | `TabBarRedesign.tsx` exists with 4 tabs: Home (`/driver`), Jobs (`/driver/jobs`), Earn (`/driver/earnings`), Me (`/driver-account/profile`). | `client-app/src/components/TabBarRedesign.tsx#L59-L64` | **Partially Implemented** | Renamed "Trips" to "Jobs" and dropped upcoming bookings tab from main nav. | `client-app` | High |
| **§1 Category** | Earnings as a first-class surface (real-time ticker, daily card, weekly chart, payout CTA) | `client-app/src/app/driver/earnings/page.tsx` exists with charts, payout CTA, and summary cards. | `client-app/src/app/driver/earnings/page.tsx#L1-L240` | **UI Only** | Backend `GET /api/v1/driver/earnings` returns hardcoded fake values (`3800000` paise). | `workers/api` | High |
| **§1 Category** | Trip Planner / agenda (upcoming scheduled bookings with date grouping; demand forecast empty state) | `/driver/trips/page.tsx` has scheduled booking list. Empty state forecast does not exist. | `client-app/src/app/driver/trips/page.tsx#L41-L100` | **Partially Implemented** | Endpoints `/api/v1/driver/trips/upcoming` and `/api/v1/driver/scheduled-offers` 404 on edge API. | `workers/api`, Neon DB | High |
| **§1 Category** | Offer card discipline (full-screen takeover, fare, distance, countdown ring, slide accept) | `OfferScreen.tsx` and `useOfferStore.ts` exist with circular SVG countdown and accept/decline buttons. | `client-app/src/components/OfferScreen.tsx#L1-L180`, `src/store/useOfferStore.ts` | **Partially Implemented** | Slide accept not built (uses tap buttons). Backend `/api/v1/driver/orders/:id/offer-response` 404s. | `workers/api` | High |
| **§1 Category** | Map layers (demand heat, surge zones toggleable over one map) | `DriverMap.tsx` and `HomeOnline.tsx` exist; Heatmap SSE stream connected via `HeatmapDO`. | `client-app/src/components/home/HomeOnline.tsx#L1-L150`, `workers/api/src/durable-objects/HeatmapDO.ts` | **Implemented, Runtime Unverified** | Missing toggle chips UI for surge zones vs demand clusters. | `client-app` | High |
| **§1 Category** | Driver trust center (documents with expiry chips, insurance, training, SOS, emergency contact) | Account subpages exist (`/driver-account/documents`, `/driver-account/profile`). | `client-app/src/app/driver-account/` | **Partially Implemented** | Document expiry chips exist in UI; emergency contact post-onboarding CRUD missing on backend. | Neon DB, R2 | High |
| **§2 Design** | Responsive breakpoints: base 360-430px, sm:640, md:768, lg:1024 | Tailwind configured with custom breakpoints; max-width containers and safe-area insets applied. | `client-app/src/components/TabBarRedesign.tsx#L76-L79`, `client-app/tailwind.config.js` | **Verified Complete** | Verify landscape phone layout on small devices. | None | High |
| **§2 Design** | Bottom tab bar <= md, converts to left rail >= md | Bottom tab bar has fixed bottom positioning. Responsive left rail on desktop not implemented in driver app. | `client-app/src/components/TabBarRedesign.tsx#L70-L105` | **Partially Implemented** | Driver app is strictly mobile-first; left rail desktop view is low priority. | `client-app` | Medium |
| **§2 Design** | Interactive controls >= 44x44px; primary CTAs full-width, bottom-anchored, safe-area aware | Touch targets use `min-h-[48px] min-w-[48px]`, full-width CTAs with `pb-[env(safe-area-inset-bottom)]`. | `client-app/src/components/TabBarRedesign.tsx#L88`, `client-app/src/app/driver/page.tsx` | **Verified Complete** | None. | None | High |
| **§2 Design** | Text minimums: no info text < 12px; money/ETA in mono >= 16px | `FareDisplay.tsx` and typography tokens enforce font sizes; money amounts use tabular mono font. | `client-app/src/components/ds/FareDisplay.tsx#L1-L50` | **Verified Complete** | None. | None | High |
| **§2 Design** | Map sheets: peek 96px, half 50%, full — draggable, never covering CTA | Custom sheet components exist (`HomeOffline.tsx`, `HomeOnline.tsx`) with collapsed peek states. | `client-app/src/components/home/HomeOnline.tsx#L40-L90` | **Implemented, Runtime Unverified** | Ensure sheet dragging gestures don't conflict with map panning on mobile. | `client-app` | Medium |
| **§3 IA** | 4-tab IA: Home, Trips (Upcoming \| History), Earnings, Account | `TabBarRedesign.tsx` links to `/driver`, `/driver/jobs`, `/driver/earnings`, `/driver-account/profile`. | `client-app/src/components/TabBarRedesign.tsx#L59-L64` | **Partially Implemented** | Disconnected `/driver/trips` (which has Upcoming) in favor of `/driver/jobs` (History only). | `client-app` | High |
| **§3 IA** | Trip-flow overlays stay state-driven on Home | `DriverTerminalPage.tsx` conditionally mounts `ArrivedVerificationPane`, `TripInProgressPane`, `OfferScreen`. | `client-app/src/app/driver/page.tsx#L250-L400` | **Verified Complete** | Unify duty state machine enum with backend order status enum. | `useDriverDutyStore` | High |
| **§4 Screens** | Shell: NEW bottom tab bar replacing drawer; drawer content folded into Account | `TabBarRedesign.tsx` replaces old drawer; navigation items relocated to `/driver-account/*`. | `client-app/src/components/TabBarRedesign.tsx`, `client-app/src/app/driver-account/` | **Verified Complete** | Clean up unused legacy `DriverNav.tsx` or drawer artifacts. | `client-app` | High |
| **§4 Screens** | Home offline: bento (shipped) + demand-forecast tile | Bento grid implemented in `HomeOffline.tsx`. Demand-forecast tile is missing. | `client-app/src/components/home/HomeOffline.tsx#L1-L120` | **Partially Implemented** | Build demand forecast card and connect to backend. | `client-app`, `workers/api` | High |
| **§4 Screens** | Home online: map + heat layer toggle chips; collapsed bento peek | Map and duty bar exist; collapsed bento peek implemented; heatmap layer rendered. | `client-app/src/components/home/HomeOnline.tsx#L1-L150` | **Verified Complete** | Add interactive toggle chips for map layers (demand vs traffic). | `client-app` | Medium |
| **§4 Screens** | Offer card: keep; add distance-to-pickup + payout estimate prominently | `OfferScreen.tsx` displays fare, distance, duration, pickup address, and circular timer. | `client-app/src/components/OfferScreen.tsx#L50-L120` | **Verified Complete** | Backend offer dispatch route must be built to feed this screen. | `workers/api` | High |
| **§4 Screens** | Trips -> Upcoming: date-grouped scheduled bookings, accept/decline, reminders | `src/app/driver/trips/page.tsx` implements `ScheduledOffersList` with commit/decline buttons. | `client-app/src/app/driver/trips/page.tsx#L41-L120` | **UI Only** | Wire to main navigation; implement backend endpoints in `workers/api`. | `workers/api`, Neon DB | High |
| **§4 Screens** | Trips -> History: existing list restyled to Aura + filters | `src/app/driver/jobs/page.tsx` and `src/app/driver-account/trip-history/` use Aura tokens. | `client-app/src/app/driver/jobs/page.tsx#L1-L92` | **Verified Complete** | Merge redundant `/driver/jobs` and `/driver/trips` pages into a single tab with sub-views. | `client-app` | High |
| **§4 Screens** | Earnings home: ticker, day card, 7-day chart, payout CTA, quests strip | Full screen exists in `src/app/driver/earnings/page.tsx`. | `client-app/src/app/driver/earnings/page.tsx#L1-L240` | **UI Only** | Replace mock `getDriverEarnings` backend stub with real ledger aggregation query. | `workers/api`, Neon DB | High |
| **§4 Screens** | Payouts: bank state, instant-payout CTA, history | Screen exists; calls `requestPayout` (`/api/v1/driver/payouts/request`). | `client-app/src/app/driver-account/payouts/page.tsx`, `workers/api/src/routes/driver.ts#L254` | **Implemented, Runtime Unverified** | Connect payout request to Cloudflare Queue/Workflow (`PayoutBatchWorkflow.ts`). | Cloudflare Queues | Medium |
| **§4 Screens** | Documents: expiry chips (VALID/EXPIRING/EXPIRED), re-upload via presigned flow | Screen exists; client calls `/api/v1/driver/onboarding/presigned-url`. | `client-app/src/app/driver-account/documents/page.tsx`, `client-app/src/api/client.ts#L1023` | **UI Only** | Cloudflare R2 presigned URL generation and document upload routes missing in `workers/api`. | Cloudflare R2 | High |
| **§4 Screens** | Safety center: SOS settings + emergency contact CRUD + insurance | SOS modal exists; triggers `/api/v1/driver/sos`. Emergency contact CRUD missing backend storage. | `client-app/src/components/SosModal.tsx`, `workers/api/src/routes/driver.ts#L320` | **Partially Implemented** | Implement `PATCH /api/v1/driver/profile/emergency-contact` to store in `drivers` table. | `workers/api`, Neon DB | High |
| **§4 Screens** | Onboarding: keep 7 steps; restyle to Aura; real upload progress | Multi-step onboarding exists in `client-app/src/app/driver-onboarding/page.tsx`. | `client-app/src/app/driver-onboarding/page.tsx#L1-L300` | **Partially Implemented** | KYC step submissions 404 because onboarding API routes were not ported to `workers/api`. | `workers/api` | High |
| **§4 Screens** | Settings: notification prefs, language, dark-map toggle | Preferences UI exists in `client-app/src/app/driver-account/settings/page.tsx`. | `client-app/src/app/driver-account/settings/page.tsx#L1-L150` | **UI Only** | Endpoints `/notifications/preferences` and `/profile/language` 404 on edge API. | `workers/api` | High |
| **§5.1 API** | `GET /api/v1/driver/trips/upcoming` | Function exists in `client.ts:576`. Route NOT registered in `workers/api`. | `client-app/src/api/client.ts#L576`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Implement Hono route querying `orders WHERE driver_id = ? AND scheduled_at > now()`. | `workers/api`, Neon DB | High |
| **§5.1 API** | `POST /api/v1/driver/scheduled/{id}/accept` + `/decline` | Functions exist in `client.ts:596,604`. Routes NOT registered in `workers/api`. | `client-app/src/api/client.ts#L596,L604`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Implement commitment endpoint and assignment update. | `workers/api`, Neon DB | High |
| **§5.1 API** | `PATCH /api/v1/driver/profile/emergency-contact` | Function exists in `client.ts:1604`. Route NOT registered in `workers/api`. | `client-app/src/api/client.ts#L1604`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Implement route updating `drivers.emergency_contact` JSONB. | `workers/api`, Neon DB | High |
| **§5.1 API** | `GET /api/v1/driver/city-config` | Removed from `client.ts:31-32` because backend route was rider-only. | `client-app/src/api/client.ts#L31-L32`, `DOC/DRIVER_APP_OPEN_ISSUES.md#L72` | **Missing After Scoped Inspection** | Implement shared or driver-scoped city configuration endpoint. | `workers/api` | High |
| **§5.1 API** | `GET /api/v1/driver/demand-forecast` | Function exists in `client.ts:1594`. Route NOT registered in `workers/api`. | `client-app/src/api/client.ts#L1594`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Aggregate historical trip density into H3 hourly forecasts or return KV snapshots. | Cloudflare KV | High |
| **§5.2 Hardening** | `GET /driver/incentives` (quests table) | Client calls `/api/v1/driver/incentives`. Route NOT in `workers/api`. | `client-app/src/api/client.ts#L640`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Implement `driver_quests` table and progress calculation. | `workers/api`, Neon DB | High |
| **§5.2 Hardening** | `GET /driver/performance` (reviews/ratings calculation) | Client calls `/api/v1/driver/performance`. Route NOT in `workers/api`. | `client-app/src/api/client.ts#L644`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Query aggregated reviews from `order_reviews` table. | `workers/api`, Neon DB | High |
| **§5.2 Hardening** | `GET /driver/referrals` (persisted referral codes) | Client calls `/api/v1/driver/referrals`. Route NOT in `workers/api`. | `client-app/src/api/client.ts#L648`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Query referral attribution and bonuses from `driver_referrals` table. | `workers/api`, Neon DB | High |
| **§5.2 Hardening** | Payout rails state machine (`payout_history` PENDING->PROCESSING->PAID/FAILED) | Cloudflare Workflow `PayoutBatchWorkflow.ts` created for batch payouts. | `workers/api/src/workflows/PayoutBatchWorkflow.ts#L1-L80` | **Implemented, Runtime Unverified** | Connect workflow trigger to scheduled cron or admin payout approval. | Cloudflare Workflows | High |
| **§5.2 Hardening** | Document expiry nightly job flipping status to EXPIRING/EXPIRED | Cloudflare Workflow `DocExpiryWorkflow.ts` created. | `workers/api/src/workflows/DocExpiryWorkflow.ts#L1-L60` | **Implemented, Runtime Unverified** | Connect to `workers/cron` schedule to execute daily. | Cloudflare Cron | High |
| **§5.3 Push** | FCM push via Kafka consumer on GCP VM | Cloudflare edge does not use Kafka. FCM sender implemented in TypeScript using Web Crypto RS256 JWT. | `workers/api/src/services/fcm.ts#L1-L90`, `DOC/ADR-cloudflare-migration.md#L41` | **Superseded** | Wire `fcm.ts` to trigger on dispatch offer and scheduled booking reminders. | Cloudflare Workers | High |
| **§5.3 Push** | Device token storage via `/driver/device-token` | `registerDriverPushNotifications()` calls `/api/v1/driver/device-token`. Route missing in `workers/api`. | `client-app/src/app/login/page.tsx#L105`, `workers/api/src/routes/driver.ts` | **Missing After Scoped Inspection** | Implement `POST /api/v1/driver/device-token` to store FCM token in `driver_devices`. | `workers/api`, Neon DB | High |
| **§5.3 Push** | WS frames cover offer/cancel/chat | WebSockets handled by `OrderStreamDO.ts` and `RiderStreamDO.ts`. Driver stream uses `OrderStreamDO`. | `workers/api/src/durable-objects/OrderStreamDO.ts`, `client-app/src/hooks/useResilientWebSocket.ts` | **Partially Implemented** | Driver connects to `global-driver` when idle, but `queue.ts` broadcasts offers to `orderId` DO! | Cloudflare DO | High |
| **§5.4 Infra** | `OSRM_BASE_URL` on GCP VM with Docker Compose | Cloudflare Worker uses `workers/api/src/services/maps.ts` calling OSRM or straight-line fallback. | `workers/api/src/services/maps.ts#L1-L65` | **Superseded** | Configure external routing API (Google Maps / Mapbox / hosted OSRM) via env secret. | Cloudflare Workers | High |
| **§5.4 Infra** | Firebase Hosting stays for frontend; gateway redeploy per phase | Architecture migrated to Cloudflare Workers Static Assets (`ADR-cloudflare-migration.md`). | `DOC/ADR-cloudflare-migration.md#L28` | **Superseded** | Deploy Next.js static exports via Cloudflare Pages or Workers Static Assets. | Cloudflare | High |
| **§6 Phases** | P1: Shell & IA (Bottom tab bar + route restructure) | `TabBarRedesign.tsx` created; routes restructured. | `client-app/src/components/TabBarRedesign.tsx` | **Verified Complete** | Align tab bar routing between `/driver/jobs` and `/driver/trips`. | `client-app` | High |
| **§6 Phases** | P2: Earnings surface & backend hardening | Frontend built; backend hardening not done (still returning hardcoded fake values). | `workers/api/src/routes/driver.ts#L221` | **Partially Implemented** | Build real earnings calculation queries. | `workers/api`, Neon DB | High |
| **§6 Phases** | P3: Trip Planner (Upcoming trips + scheduled accept/decline) | Frontend partially built; backend endpoints missing. | `client-app/src/app/driver/trips/page.tsx` | **Partially Implemented** | Implement backend scheduled booking queries and commitment handlers. | `workers/api`, Neon DB | High |
| **§6 Phases** | P4: Safety & Compliance (Safety center, emergency contact, document expiry) | Frontend built; DocExpiryWorkflow created; emergency contact backend missing. | `workers/api/src/workflows/DocExpiryWorkflow.ts` | **Partially Implemented** | Connect emergency contact endpoint and document upload to R2. | `workers/api`, R2 | High |
| **§6 Phases** | P5: Map & Demand (Layer toggle chips, demand-forecast tile, OSRM) | HeatmapDO built; OSRM service exists; forecast tile missing. | `workers/api/src/durable-objects/HeatmapDO.ts` | **Partially Implemented** | Add layer toggles in UI and demand forecast aggregation. | `client-app`, `workers/api` | High |
| **§7 Scope** | Out of scope: Native app packaging (Capacitor shell unchanged) | Capacitor 8 shell exists, but lacks native background geolocation and foreground services! | `client-app/capacitor.config.ts`, `client-app/package.json` | **Defective Assumption** | In a driver app, background location is mandatory; web JS stops when phone locks! | Capacitor Native | High |
| **§7 Scope** | Out of scope: Real PSP integration (state machine yes, live money no) | Simulated payouts implemented; Razorpay/Juspay payout webhooks not wired. | `workers/api/src/routes/driver.ts#L254` | **Verified Complete** | Kept in scope as simulated state machine per plan rules. | None | High |

---

## 4. Verification of Specific High-Risk Claims

### 4.1 Client-App Ownership & Routing
- **Claim:** `client-app/` owns the driver experience; drawer navigation should be replaced by a 4-tab bottom navigation bar (`/driver`, `/driver/trips`, `/driver/earnings`, `/driver-account`).
- **Validation:** Confirmed that `client-app/` is the driver application. `TabBarRedesign.tsx` was implemented, but the second tab was routed to `/driver/jobs` (rendering `JobsListScreen` with completed job history) instead of `/driver/trips` (which hosts the upcoming scheduled bookings UI). As a result, the "Trip Planner" capability described in Section 1 and Section 3 is inaccessible from the main navigation.

### 4.2 Aura Tokens & Typography
- **Claim:** All screens use Aura tokens (`tokens.css`, `forest/sage`), with Playfair reserved for display titles and numbers in tabular mono.
- **Validation:** Confirmed. `client-app/src/app/globals.css` defines the Aura design tokens (`--background-primary`, `--accent-500`, `--interactive-primary`, etc.). Components across `client-app/src/components/ds/` strictly consume these tokens.

### 4.3 State-Driven Trip Overlays
- **Claim:** Trip lifecycle overlays (`OfferScreen`, navigate, arrive/OTP, in-trip, bill, rate) stay state-driven on the Home screen (`/driver`).
- **Validation:** Confirmed. `client-app/src/app/driver/page.tsx` mounts state-driven panels: `OfferScreen` when `useOfferStore` is pending, `ArrivedVerificationPane` when arrived, and `TripInProgressPane` during transit. However, state naming diverges between `useDriverDutyStore` (which uses `DELIVERING`) and the database/backend (which uses `IN_TRANSIT`).

### 4.4 Offer Cards and Acceptance Behavior
- **Claim:** Offer card has full-screen takeover, countdown ring, and one-slide accept. Vahanly already has this.
- **Validation:** Partially true. `OfferScreen.tsx` displays the countdown ring and trip details. However, it uses standard button taps rather than a slide-to-accept control. More critically, the underlying acceptance call (`respondToOffer` -> `PATCH /api/v1/driver/orders/:id/offer-response`) fails with 404 because the route is not implemented in `workers/api/src/routes/driver.ts`.

### 4.5 The "60+ Driver Routes" Backend Assumption
- **Claim:** "Existing surface is broad (60+ driver routes — auth, duty, offers, trip lifecycle, odometer, earnings/ledger, payouts, wallet, vehicles, documents...)"
- **Validation:** **Completely Inaccurate.** While the legacy Go repository had dozens of handlers, the active Cloudflare Worker edge backend (`workers/api/src/routes/driver.ts`) has only **12 registered routes**. Crucial endpoints required for daily driver operations (offers, event recording, upcoming trips, document uploads, KYC verification, performance) do not exist on the edge.

### 4.6 Rider-Side `scheduled_at` Persistence
- **Claim:** Rider side already writes `orders.scheduled_at`.
- **Validation:** Confirmed in schema (`database/migrations/000001_initial_schema.up.sql`), but in `workers/api/src/routes/orders.ts#L112-L143`, `handleCreateOrder` does NOT read or write `scheduled_at` from the request body! Scheduled bookings are not persisted to the database upon order creation.

### 4.7 Emergency Contact Storage
- **Claim:** Emergency contact can be edited post-onboarding via `PATCH /api/v1/driver/profile/emergency-contact` writing to `onboarding_data` JSONB.
- **Validation:** `client-app/src/api/client.ts:1604` implements the client call, but `workers/api/src/routes/driver.ts` has no corresponding route. Updating an emergency contact fails with a 404.

### 4.8 Earnings, Wallet, Ledger, and Payouts
- **Claim:** Real-time per-trip ticker, daily card, weekly bar chart, payout CTA backed by real tables.
- **Validation:** The frontend UI is implemented (`client-app/src/app/driver/earnings/page.tsx`), but the backend handler (`workers/api/src/routes/driver.ts#L221-L228`) returns hardcoded mock constants (`withdrawable_paise: 3800000`, `total_earnings_paise: 4500000`). No SQL aggregation of completed trips, commission deductions, or wallet balances exists.

### 4.9 Push Notifications & Realtime Architecture
- **Claim:** FCM server-side sender consuming Kafka topics on the VM; device tokens stored via `/driver/device-token`.
- **Validation:** Obsolete and broken. Kafka is no longer part of the Cloudflare edge stack. A native TypeScript FCM service exists (`workers/api/src/services/fcm.ts`), but `/api/v1/driver/device-token` is not implemented in `workers/api`. Furthermore, client push registration silently no-ops because `NEXT_PUBLIC_FCM_VAPID_KEY` is a placeholder (`DOC/DRIVER_APP_OPEN_ISSUES.md#L102`).

### 4.10 OSRM and Local Fallback Routing
- **Claim:** `OSRM_BASE_URL` on the VM returns road polylines instead of `LOCAL_FALLBACK` straight lines.
- **Validation:** Obsolete infrastructure claim. Routing on Cloudflare edge is handled by `workers/api/src/services/maps.ts`, which attempts an HTTP call to an external OSRM endpoint before falling back to straight-line Euclidean distance.

---

## 5. Summary of Plan Validation

| Category | Total Claims Evaluated | Verified Complete | Partially Implemented / UI Only | Missing / Defective / Obsolete |
|:---|:---:|:---:|:---:|:---:|
| **Design, Tokens & UI** | 12 | 8 | 4 | 0 |
| **Information Architecture** | 4 | 2 | 2 | 0 |
| **Backend & API Readiness** | 16 | 0 | 4 | 12 |
| **Realtime, Push & Infra** | 8 | 1 | 2 | 5 |
| **Total** | **40** | **11 (27.5%)** | **12 (30.0%)** | **17 (42.5%)** |

**Conclusion:** The visual and component design proposed in `DOC/DRIVER_APP_REDESIGN_PLAN.md` is largely complete and well-crafted. However, the plan's architectural assumptions and backend delivery plan are severely outdated and defective. A complete V2 revision is required to align the driver app with the Cloudflare edge architecture, fix disconnected dispatch and offer loops, eliminate security backdoors, and implement real financial ledger calculations.
