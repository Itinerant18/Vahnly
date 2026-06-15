# Drivers-for-u — Codebase Map (cognitive cache)

> Built by a full-read pass of every source file (~146 Go files / ~47k LoC + ~333 frontend
> TS/TSX / ~68k LoC + 164 SQL migrations + Helm/compose). This is the human-readable index;
> for query-scoped subgraphs use `graphify query "<q>"` / `graphify-out/GRAPH_REPORT.md`.
>
> **Product:** a ride-hailing-style marketplace where **riders own a car and book a *driver*
> to operate it** (not a taxi). Region-sharded (Kolkata "KOL"). Module
> `github.com/platform/driver-delivery`. Money is integer **paise** everywhere.

---

## 1. The four systems & the event spine

```
 RIDER APP (rider-app, Next.js)        DRIVER APP (client-app, customized Next.js)   ADMIN (frontend, Vite SPA)
        │ WS /ws/rider (JSON)              │ WS /api/v1/dispatch/stream (protobuf)       │ SSE heatmap + WS dispatch/stream + REST polls
        └──────────────┬───────────────────┴───────────────────┬──────────────────────────┘
                       ▼                                         ▼
                 GATEWAY (cmd/gateway, BFF)  ── Redis pub/sub backplane ──  pod-agnostic WS fan-out
                       │  Kafka producer/consumer + REST + WS hubs
        ┌──────────────┴─────── Kafka event spine ───────────────────────────┐
   order.created → DISPATCH (matching) → order.assigned + driver.state.changed
   ingestion(gRPC) → driver.location.updated / global.region.handoffs
   surge.zone.updated → pricing ;  notification_outbox(DB) → notification(FCM)
```

**14 service binaries + 1 simulator** (`cmd/*`), one Postgres+PostGIS, one 6-node Redis
**Cluster**, Kafka (compose uses `confluentinc/cp-kafka`; `KAFKA_BROKERS` default `:19092`
in sim), MinIO/S3, and Triton (CPU-only inference, optional).

### Kafka topic spine (producer → consumer)
| Topic | Produced by | Consumed by (group) |
|---|---|---|
| `order.created` | gateway `HandleCreateOrder`, rider `booking_service.go:423`, expiry re-queue, dispatch re-queue | **dispatch** `order_consumer.go:85` (`dispatch-matching-group`); **surge demand** (`surge-demand-aggregator-group`) |
| `order.created.dlq` | dispatch DLQ | — |
| `order.assigned` | dispatch `order_consumer.go:94`; reconciler `order_reconciler.go:32` | gateway fan-out `cmd/gateway/main.go:1232` (`gateway-fanout-group-collective`); reconciler audits |
| `driver.state.changed` | dispatch (on match), gateway (status change) | **surge supply** (`surge-supply-aggregator-group`); **analytics heatmap** (`kolkata-analytics-heatmap-group`) |
| `driver.location.updated` | ingestion `telemetry/repository/kafka_producer.go:21` | (sink/analytics; not a realtime-critical consumer) |
| `global.region.handoffs` | ingestion region router | dispatch handoff consumer (`dispatch-handoff-<region>`) |
| `surge.zone.updated` | surge calculator `surge_calculator.go:37` | **pricing** `order_pricing_service.go:54` → writes `surge:matrix` |
| `incident.sos`, `trip.anomaly`, `incident.created`, `driver.rated`, `order.cancelled`, `driver.payout.requested`, `support.ticket.created`, `trip.car.issue` | various handlers | **no in-repo consumer** — intentional event log; SOS/notifications are delivered via the `notification_outbox` DB table + in-process callbacks, not by consuming these topics |

### Service one-liners (`cmd/`)
- **gateway** — the BFF/edge. Auth+RBAC, order intake, trip lifecycle state machine, WS hubs (driver + rider), Kafka↔Redis↔WS bridge, ~50 admin handler groups, analytics SSE reverse-proxy. Public host `:8085`→container `8080`; metrics `:9090`. Fails closed without `JWT_SECRET_SIGNING_KEY` + `FIELD_ENCRYPTION_KEY`.
- **dispatch** — matching brain. Consumes `order.created`, batches (adaptive 100–400ms EWMA window), runs Kuhn-Munkres assignment with Triton ETA correction + CH routing, emits `order.assigned`/`driver.state.changed`, pushes `rider.order.assigned`. **Runs DB migrations on boot.**
- **ingestion** — gRPC client-streaming GPS intake (`:50051`); writes Redis spatial index, emits `driver.location.updated` + region handoffs.
- **surge** — supply+demand aggregators per H3 cell → `surge.zone.updated` (cap 4.5).
- **pricing** — consumes `surge.zone.updated` → writes `surge:matrix:<city>:<cell>` (12h TTL).
- **expiry** — offer-timeout janitor (15s offer TTL) → re-injects `order.created`.
- **reconciler** — anti-entropy: re-emits stuck `ASSIGNED` orders; asserts ledger balance.
- **notification** — polls `notification_outbox` (`FOR UPDATE SKIP LOCKED`, 2s, at-least-once) → FCM (**mocked**).
- **analytics** — consumes `driver.state.changed` → heatmap **SSE** `/api/v1/analytics/heatmap` (`:8089`).
- **rebalancer** — reads Redis supply → driver positioning nudges (`POST /api/internal/surge/nudge`).
- **pruner** — GC of stale Redis telemetry (60s threshold) → marks drivers OFFLINE.
- **migrate** — one-shot golang-migrate runner. **osm-preprocessor** — offline OSM→CSV graph build. **simulator** — load/chaos/E2E harness.

---

## 2. Realtime architecture (the canonical reference)

Three **Redis pub/sub channels** make the multi-pod gateway pod-agnostic — any pod publishes,
the pod holding the socket delivers:

| Channel (constant) | Direction | Carries |
|---|---|---|
| `gateway:rider:broadcast` (`rider/realtime/realtime.go:16`) | rider hub subscribes; many services publish | JSON `Envelope{rider_id,type,data}` → `rider.*` events |
| `gateway:assignments:broadcast` (`gateway/.../handler.go:47`, `RedisPubSubChannel`) | gateway multiplexer subscribes; dispatch + admin publish | driver assignment/offer; protobuf-encoded to driver WS (except `"fare_estimate"`/force JSON passthrough) |
| `gateway:telemetry:broadcast` (`handler.go:48`, `RedisTelemetryChannel`) | gateway multiplexer subscribes; telemetry publishes | driver live location → `TelemetryFrame` to driver/admin WS |

### WebSocket auth — ticket-based (both sides, all 3 apps)
`POST /api/v1/ws/ticket` (JWT in `Authorization` header) → 32-byte hex ticket in Redis
`ws:ticket:<t>` (**30s TTL**), validated with **`GETDEL`** (single-use, replay-proof). Connect
with `?ticket=`. **No `?jwt=` fallback.** Every reconnect re-mints. (`middleware/ws_ticket.go`.)

### Rider WS message types (`rider/realtime/realtime.go:19-28`) → frontend handler → backend emitter
| Type string | rider-app handler (`app/(app)/trip/LiveTripView.tsx`) | Backend emitter |
|---|---|---|
| `rider.order.assigned` | `updateStatus("ASSIGNED")` + `setDriverInfo` | `dispatch/consumer/order_consumer.go:798`; admin force-match `orchestrator_handler.go:274` |
| `rider.driver.location` | `updateDriverLocation` | `telemetry/usecase/telemetry_usecase.go:151` |
| `rider.driver.arrived` | `updateStatus("ARRIVED_AT_PICKUP")` (shows OTP) | `driver/delivery/http/driver_trip_handler.go:130` |
| `rider.trip.started` | `updateStatus("DELIVERING")` | `driver/.../driver_trip_handler.go:290` |
| `rider.trip.completed` | `COMPLETED` + `setCompletedFare` → `/trip/bill` | gateway `handler.go:1433` |
| `rider.trip.cancelled` | `CANCELLED` → `/home` | `rider/service/booking_service.go:542` |
| `rider.notification` | `notificationStore.addNotification` | `booking_service.go:724` |
| `rider.ride_check` | safety modal | `rider/monitor/ride_check.go:138` |
| `rider.fare.updated` | `updateFareEstimate` (live fare strip) | gateway `driver_trip_handler.go:191` |

### Driver WS frames — protobuf `WebSocketBinaryEnvelope` (`pkg/api/v1/stream_framing.pb.go`)
`FRAME_TYPE_ASSIGNMENT=1` → `AssignmentFrame{order_id,driver_id,city_prefix,status}` ·
`FRAME_TYPE_TELEMETRY=2` → `TelemetryFrame{ids,lat,lng,bearing,speed_kms,timestamp_utc}`.
Driver consumes via `services/dispatchStream.ts` (binary) → `onAssignment` calls
`getPendingOffer` (normal 15s offer) or `hydrateForceMatch` (admin force-match: status
`ASSIGNED`, no pending offer → REST-hydrate the order). Enriched offers with `"fare_estimate"`
are forwarded as raw JSON text (`handler.go:368`).

### Admin realtime
- **Heatmap SSE**: `frontend/.../ControlRoomDashboard.tsx:118` `EventSource(/api/v1/analytics/heatmap)` (SUPER_ADMIN/FLEET_MANAGER), 2.5s flush. Backend analytics svc `:8089`; gateway reverse-proxies it same-origin (`cmd/gateway/main.go`, `ANALYTICS_SSE_URL`).
- **Per-order WS**: `ActiveTripRadar.tsx` runs one `ResilientStreamManager` per active order over `/api/v1/dispatch/stream`, + 10s `/admin/orders` poll fallback.
- **Incident WS**: `IncidentRecoveryTerminal.tsx` connects `order_id=global-sos` for SOS frames.
- Most other admin "live" pages are **poll-on-mount/refetch**, not streamed.

### Key Redis namespaces
`ws:ticket:<t>`(30s) · `ws:presence:<order>`/`ws:rider:presence:<rider>`(30m) ·
`drivers:zset:<city>:<h3cell>` (spatial ZSET, score=ping epoch, 30s stale window) ·
`driver:{city:driverID}:status|current_cell|profile` · `driver:locations:<region>` (GEO) ·
`driver:active:trip:<driver>` · `order:rider:<order>`(6h, GPS fan-out lookup) ·
`offer:lease:<order>`(15s) · `offer:forcematch:<order>` · `cooldown:driver:<id>`(30s) ·
`surge:demand|supply:{city}:<cell>` (forward-expiry score) · `surge:matrix:<city>:<cell>`(12h) ·
`surge:freeze:<city>:<cell>` (admin cap, only lowers) · `incidents:active` (SOS queue hash) ·
`rider:active:order:<rider>`(4h) · `rider:session:<rider>` / `driver:session:<id>` (revocable jti) ·
`ratelimit:user:<id>` · `idempotency:settlement:<order>` · `notification:lock:fence:<order>`.

---

## 3. Order state machine (Postgres enum, SQL-guard enforced)

No Go transition table — `order_status_enum` + `WHERE status='<expected>'` optimistic guards.
```
CREATED → ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → DELIVERING → COMPLETED
   └────────────────────── (any non-terminal) ──────────────────────────→ CANCELLED
```
| Transition | Site |
|---|---|
| CREATED→ASSIGNED | dispatch `order_consumer.go:630` |
| ASSIGNED→EN_ROUTE_TO_PICKUP | gateway accept `handler.go:520` |
| EN_ROUTE→ARRIVED_AT_PICKUP | driver `driver_trip_handler.go:88` (409 guard) |
| ARRIVED→DELIVERING | driver verify-OTP `driver_trip_handler.go:200` (SHA-256 OTP, 3-attempt lockout) |
| DELIVERING→COMPLETED | odometer end / payment webhook / driver complete `handler.go:1361` (double-entry ledger 80/20) |
| *→CANCELLED | rider cancel / admin cancel |

`drivers` has **two parallel state models**: `current_state` (`driver_state_enum`) and the newer
`duty_state` (`driver_duty_state`, mig 000059) — a dual-source-of-truth seam.

---

## 4. Backend domains (`internal/`)

- **gateway/** (17 files) — `GatewayHandler` trip lifecycle + telemetry ingest + payments (HMAC webhook, double-entry ledger, tiered commission 20/15/12%) + GPS write-behind buffer; `InternalBackplaneMultiplexer` (Redis→protobuf WS); rider `Hub` (`rider/realtime/`); middleware chain **metrics → CORS → auth(JWT/cookie + RBAC) → ws-ticket → ratelimit → region-router** (metrics `statusRecorder` preserves Hijacker+Flusher → WS & SSE safe).
- **rider/** (16) — phone-OTP auth (bcrypt OTP, single-session jti), booking lifecycle (`booking_service.go` — one active trip/rider, sha256 trip OTP, promo redeem-in-tx, `order.created`), realtime hub, ride-check anomaly monitor (no-movement), DPDP export/erasure.
- **dispatch/** (7) — `matcher/hungarian.go` (**"greedy" and "Hungarian" both call the same Kuhn-Munkres solver**; only batching differs), spatial scanner (progressive K-ring 1→3), order consumer, reconciler, offer-expiry janitor, region handoff (LWW Lua CAS).
- **driver/** — driver HTTP trip handlers (arrive, verify-OTP-start). (Complete lives in gateway.)
- **telemetry/** (9) — gRPC ingest usecase, Redis spatial writes (WATCH/TxPipelined), live fan-out (60ms budget, only on active trip), Kafka producer, region router, stale pruner.
- **surge/** (3) — demand/supply aggregators + calculator (`demand/(supply*0.7)`, cap 4.5).
- **pricing/** (2) — surge-matrix consumer/quoter (`computeFarePaise = (base+perMeter*m)*surge`, freeze cap) + `SurgeRegulator` circuit breaker.
- **routing/** (4) — Contraction-Hierarchies bidirectional Dijkstra over OSM CSV; hybrid Google-Maps-or-local router (latency-gated: skips Google when <50ms budget).
- **intelligence/** (4) — Triton gRPC client (`input__0` FP32; **every error path returns neutral**), `ETACorrector` (xgboost_spatial_corrector) + cancellation-risk classifier (risk≥0.75 prunes driver); positioning/rebalancer.
- **admin/** (41, flat package) — ~40 REST handler groups: dashboard/alerts (Redis `incidents:active`), **orchestrator** (force-match → publishes to both WS channels), safety/SOS, finance (refunds/wallets/disputes/reconciliation, `FOR UPDATE`), payouts (advisory-lock batch), pricing/surge config (Redis), promos (Redis + Postgres dual stacks), marketing, CMS, support, corporate/franchise, ESG, developer, audit, RBAC team. Many list views are **deterministic UUID-hash mock projections** over real `orders`/`drivers`.
- **domain/** — struct mirrors of tables (no logic). **events/** — `DriverStateChangedEvent`. **messaging/kafkacfg** — SASL/TLS from env + DLQ helper. **notification/** — outbox daemon + RiderNotifier (**FCM stubbed**). **crypto/** — AES-256-GCM field encryption (`enc:v1:` prefix, plaintext passthrough for un-migrated rows). **observability/** — Prometheus (`dispatch_*`, `reconciler_*`, `dfu_*`), gobreaker, health server, OTel (Kafka header propagation). **storage/** — dependency-free SigV4 S3 (MinIO/GCS-compatible). **analytics/** — heatmap SSE service.

---

## 5. Frontends

### rider-app (Next.js App Router, Capacitor mobile, Zustand)
- **Journey:** `/login` (phone-OTP / Google+Firebase-phone) → `/onboarding` → `/home` (BookingSheet) → `/dispatch` (3s active-order poll) → `/trip/live` → `/trip/bill` → `/trip/rate`. All `router.replace` (no back-stack).
- **Live screen** = `app/(app)/trip/LiveTripView.tsx` (the rich one). `[tripId]/live` is **legacy/stub returning null**; its co-located `LiveTripView.tsx` is orphaned dead code.
- **Stores:** `tripStore` (live trip + OTP localStorage persistence + `hydrateActiveOrder` on mount/reconnect), `bookingStore` (debounced fare estimate), `notificationStore`, `authStore` (token→localStorage, profile→sessionStorage, 401→logout). WS: `RiderStreamManager` (ticket auth, jittered backoff; binary location decode is a **stub**).
- **Money:** `FareDisplay` (JetBrains Mono, paise→₹) everywhere.

### client-app (DRIVER app — customized Next.js; AGENTS.md warns APIs differ — read its node_modules docs before editing)
- **Dual-role:** `/driver/*` (driver console) + `/rider/*` (a rider booking **simulator/E2E harness** with canvas maps, mock matches). They meet only at the shared backend + `useAuthStore` + unified `/login`.
- **Driver console** `app/driver/page.tsx` (~1300 lines): duty FSM `OFFLINE→ONLINE→OFFER_PENDING→EN_ROUTE→ARRIVED→DELIVERING→COMPLETED` (`useDriverDutyStore`, validated transitions; `ONLINE→EN_ROUTE` allowed for force-match). `openOnlineStreams` starts telemetry uploader + `connectDispatchStream`. On reconnect: `reconcilePendingOffer` + active-trip terminal-status reconcile.
- **Three coexisting WS clients** on `/dispatch/stream` (binary order-scoped `dispatchStream.ts`; resilient hook; JSON driver-scoped provider) — two on-wire protocols, three reconnect impls. **Duplicate offer-response logic** in duty store vs offer store. **Endpoint duplication** (`/dispatch/*` + `/trip/*` legacy vs `/driver/orders/:id/*`). Hardened `ClientCoreEngine` (idempotency key reused across retries). `VehicleTracker` (Web Worker GPS + 4s-buffered rAF interpolation).

### frontend (ADMIN — Vite SPA, react-router, no Redux)
- `main.tsx` monkey-patches `fetch` to `credentials:'include'`; redirects non-`/admin` → `/admin`. JWT in **HttpOnly `admin_session` cookie**; JS only stores `admin_role` for view-gating (backend is authoritative). Login + Google-Workspace SSO + 2FA + first-login password change; team-invite provisioning (no public self-reg).
- `adminRoutes.tsx`: `ControlRoomDashboard` eager, rest lazy; `RequireRole` route gates. ~40 feature dashboards (operations, dispatch, trips, drivers/riders/vehicles, finance/payouts, safety/support, marketing/CMS/promos, analytics/audit, corporate/franchise/ESG/developer/platform/config).
- Realtime: heatmap SSE + per-order WS (`ResilientStreamManager`, bounds-checked protobuf decode) + polls. **Most feature pages are poll-on-mount only** (Part-2 pages have no streaming).
- Caveats: dev server `:5000` (not 3000); leaflet bundled but live map uses Google Maps SDK; dual theme keys (`dfu-theme` vs `dfu-admin-theme`); `SettingsDashboard` save endpoint commented out; `.env.example` has stale `VITE_API_BASE_URL`.

---

## 6. Database (Postgres + PostGIS, 164 migrations)

Money = `BIGINT` paise (except original `orders.base_fare_paise INT`). Geo drifts from
`GEOGRAPHY(Point,4326)` (orders/drivers core) to raw `DOUBLE PRECISION`/`DECIMAL(9,6)` in
high-frequency/duty tables. Key tables: `regional_cities` (region root + geofence), `drivers`
(+ duty/wallet/docs/training/safety), `orders` (central; `otp_hash VARCHAR(64)` SHA-256,
`financial_status` separate from status enum, rider cols `garage_car_id`/one-time-car/promo/
`trip_share_token`/`sos_triggered_at`), `dispatch_match_logs`, `financial_ledger_entries`
(double-entry: RIDER_EXTERNAL_PAYMENT / DRIVER_EARNINGS / PLATFORM_COMMISSION), `payment_intents`,
`notification_outbox` + `user_device_tokens`, `order_events` (trip surcharges) + `orders_gps_trail`,
rider domain (074–092: `riders`, `rider_otp_sessions`, `rider_garage` [≤1 default car], wallet,
referrals, ...), admin back-office (033–055). **OTP weak-seed note:** mig 000060 backfills
`otp_hash` with the SHA-256 of `"1234"`.

---

## 7. Notable seams / observed tech debt (read-only findings, not fixed)

- **"Greedy" ≡ "Hungarian"** — both delegate to one Kuhn-Munkres solver (`hungarian.go:336/344`).
- **FCM is stubbed everywhere** (`outbox_processor.go:149`, `rider_notifier.go` StubFCMSender) — no real Firebase/APNs.
- **Admin auth is partly client-trusted** — `admin_role`/`admin_email` from `localStorage` sent as `X-Admin-*` headers; gating is view-level (backend RBAC is the real gate, but several admin handlers read the headers).
- **Duplicate driver OTP-start handlers** (`driver_trip_handler.go:152` emits rider WS but no identity check; `duty_handler.go:391` checks identity but no rider WS).
- **Two driver state vocabularies** (`current_state` vs `duty_state`; client `useDriverDutyStore` vs `useAppState`).
- **Mock projections** — much admin driver/rider/vehicle/trip list data is UUID-hash-synthesized, not real columns.
- **Duplicated fare constants** (4000/15) in `pricing` and `rider/booking_service`.
- Heatmap H3 cell geometry is hash-synthesized around Kolkata (placeholder positioning).

---

## 8. Where to look

| Need | Path |
|---|---|
| Service wiring / ports / topics | `cmd/<svc>/main.go` |
| Realtime channels + WS hub | `internal/gateway/delivery/http/handler.go`, `internal/rider/realtime/` |
| WS auth | `internal/gateway/middleware/ws_ticket.go` |
| Matching | `internal/dispatch/` (`matcher/hungarian.go`, `consumer/order_consumer.go`) |
| Fare/surge | `internal/rider/service/booking_service.go`, `internal/pricing/service/` |
| Order/rider schema | `database/migrations/000001`, `000060`, `000074`–`000092` |
| Rider live trip UI | `rider-app/app/(app)/trip/LiveTripView.tsx`, `rider-app/src/lib/` |
| Driver console | `client-app/src/app/driver/page.tsx`, `client-app/src/store/` |
| Admin control room | `frontend/src/admin/ControlRoomDashboard.tsx`, `frontend/src/admin/pages/` |
| Deploy | `deploy/charts/drivers-for-u/` (k8s), `deploy/gcp-vm-setup.md` (single-VM), `docker-compose.yml` |

_Regenerate scoped views: `graphify query "<question>"`, `graphify explain "<concept>"`, `graphify path "<A>" "<B>"`._
