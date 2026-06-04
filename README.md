# Drivers-for-u

A real-time, multi-region driver delivery dispatch platform. The system ingests
driver telemetry over gRPC, maintains spatial availability in Redis H3 cells,
matches orders to drivers with a configurable optimizer (greedy / Hungarian
/ circuit-breaker fallback), persists state in Postgres+PostGIS, streams
events through Kafka, runs an XGBoost ETA corrector on Triton, computes
surge pricing, and exposes a JWT-authenticated public API gateway with
WebSocket fan-out for live trip updates.

This README is a current developer orientation. For deeper dives see `DOC/`
at the bottom.

> **New here? Start with [`SETUP.md`](./SETUP.md).** It walks you from
> `git clone` to a running stack in under 15 minutes, with one command:
> `pwsh ./scripts/bootstrap.ps1` (or `./scripts/bootstrap.sh` on macOS/Linux).
> The README is the project map; `SETUP.md` is the runbook.

## Current Snapshot

- **Module:** `github.com/platform/driver-delivery`
- **Go:** 1.25.0 (see `go.mod`)
- **Stack:** Go (backend), Next.js 16 + Capacitor 8 (mobile client), Vite + React 18 (admin dashboard), Postgres 15 + PostGIS 3.3, Redis 7.2 cluster, Apache Kafka (KRaft mode), NVIDIA Triton 24.01
- **Services:** 15 Go services (ingestion, dispatch, surge, pricing, reconciler, pruner, expiry, rebalancer, gateway, notification, analytics, simulator, osm-preprocessor, server, migrate)
- **Milestones delivered:** 34+ (see [Milestones](#milestones))
- **Regions supported:** KOL (Kolkata) and BLR (Bengaluru) via region router middleware

## High-Level Runtime Path

```text
driver mobile app (gRPC stream)
  -> cmd/ingestion → Postgres + Redis H3 driver indexes + Kafka driver.location.updated
  -> cmd/dispatch consumes order.created
     → internal/dispatch matcher (greedy | Hungarian | circuit-breaker)
     → internal/routing ETA (CH-style local road graph)
     → optional internal/intelligence Triton XGBoost correction
  -> Postgres order/driver updates + Redis eviction + Kafka order.assigned
  -> cmd/surge supply/demand/calculator workers → Kafka surge.zone.updated
  -> cmd/pricing in-memory multiplier read model
  -> cmd/notification outbox → FCM/APNs push
  -> cmd/analytics SSE heatmap stream
  -> cmd/gateway WebSocket fan-out → rider app live state
  -> cmd/reconciler self-heals stuck assignments
  -> cmd/pruner evicts stale telemetry
  -> cmd/expiry times out unaccepted offers
  -> cmd/rebalancer redistributes idle drivers
```

## Quickstart (Docker Compose)

The fastest path to a running system. From the repo root in an
**Administrator PowerShell**:

```powershell
docker-compose down -v
Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-Service -Name "postgresql*" -ErrorAction SilentlyContinue
docker-compose up -d --build
```

This brings up the entire backend mesh (Postgres, Kafka, 6-node Redis
cluster, Triton, db-migrator, plus all 11 deployable Go services). The
frontend apps are decoupled and run separately.

After infrastructure is healthy (~30s):

```powershell
# Apply migrations explicitly
go run .\cmd\migrate

# Stream simulated fleet + orders
go run .\cmd\simulator
```

For the local Kubernetes path, see [Deployment](#deployment).

## Repository Map

| Path | Role |
| --- | --- |
| `api/proto` | Protobuf contracts (telemetry, triton, stream_framing). |
| `pkg/api/v1` | Generated Go bindings for the proto contracts. |
| `cmd/ingestion` | Driver telemetry gRPC streaming gateway. |
| `cmd/dispatch` | Order matching engine (greedy + Hungarian + circuit-breaker). |
| `cmd/surge` | Supply, demand, and surge calculator stream workers. |
| `cmd/pricing` | Pricing service with thread-safe in-memory surge multiplier cache. |
| `cmd/reconciler` | Self-healing state reconciliation sync worker. |
| `cmd/pruner` | Stale telemetry garbage collector for Redis/Postgres. |
| `cmd/expiry` | Offer timeout janitor for unaccepted offers. |
| `cmd/rebalancer` | Idle-driver redistribution prompts. |
| `cmd/gateway` | JWT-authenticated public API + WebSocket fan-out (BFF). |
| `cmd/notification` | Outbox pattern → FCM/APNs push notification engine. |
| `cmd/analytics` | Live spatial heatmap SSE stream. |
| `cmd/simulator` | Local telemetry + order simulator for dev/test. |
| `cmd/osm-preprocessor` | OSM PBF → local routing CSV preprocessor. |
| `cmd/migrate` | Standalone database migration runner. |
| `cmd/server` | Reserved for future consolidated service entrypoint. |
| `internal/telemetry` | Telemetry domain, gRPC handler, use case, repos. |
| `internal/dispatch` | Order consumer, matchers, spatial scanner, CH graph. |
| `internal/routing` | Local road graph loader, contraction hierarchies, ETA. |
| `internal/intelligence` | Triton gRPC client, ETA corrector, circuit breaker. |
| `internal/surge` | Supply aggregator, demand aggregator, surge calculator. |
| `internal/pricing` | Order pricing service and surge multiplier cache. |
| `internal/notification` | Outbox writer, FCM/APNs adapters. |
| `internal/analytics` | Heatmap engine and SSE writer. |
| `internal/admin` | Admin portal HTTP handlers (auth, trip, pricing, incident). |
| `internal/gateway` | Gateway HTTP/WebSocket handlers, JWT middleware, region router. |
| `internal/events` | Shared Kafka event payload contracts. |
| `internal/observability` | Prometheus, OpenTelemetry, health/readiness, gobreaker. |
| `internal/storage` | Storage layer abstractions (Postgres/Redis/Kafka/Triton). |
| `internal/test` | Integration-oriented test helpers and e2e coverage. |
| `frontend/` | Vite + React 18 admin control-room dashboard. |
| `client-app/` | Next.js 16 + Capacitor 8 driver mobile app. |
| `data/` | Local routing datasets (Kolkata OSM extract). |
| `model_repository/` | Triton model repository (ETA + cancellation risk). |
| `database/migrations/` | golang-migrate up/down scripts (single source of truth). |
| `deploy/charts/drivers-for-u/` | Production Helm chart. |
| `deploy/local/` | Local K8s topology + start/teardown scripts. |
| `deploy/keda-scaler.yaml` | KEDA ScaledObject for Kafka-consumer autoscaling. |
| `deploy/prometheus-alerts.yaml` | Production alert rules. |
| `bin/` | PowerShell helpers + pre-built dev binaries. |

## Services

### Ingestion — `cmd/ingestion`

Driver telemetry gRPC streaming gateway. Writes the latest driver
telemetry to Postgres, indexes available drivers into Redis H3 sorted
sets, emits `driver.location.updated`.

| Env var | Default | Notes |
| --- | --- | --- |
| `GRPC_PORT` | `50051` | gRPC listener. |
| `DATABASE_URL` | local Postgres | |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` | Comma-separated. |
| `KAFKA_BROKERS` | `localhost:19092` | |
| `REDIS_IP_MAP` | empty | Cluster-node-IP → local-IP overrides. |

### Dispatch — `cmd/dispatch`

Order matching engine. Consumes `order.created`, performs spatial ring
scan in Redis, evaluates matches (greedy default, Hungarian on
`ALGORITHM_STRATEGY=HUNGARIAN`, or circuit-breaker fallback when Triton
is unhealthy), persists assignments, evicts drivers, emits
`order.assigned` and `driver.state.changed`.

| Env var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` | |
| `KAFKA_BROKERS` | `localhost:19092` | |
| `ALGORITHM_STRATEGY` | `HUNGARIAN` | `HUNGARIAN` or `GREEDY`. |
| `TRITON_SERVER_URL` | `127.0.0.1:8001` | gRPC. Set empty to force fallback. |
| `METRICS_PORT` | `8080` | Prometheus + health/ready/stats. |
| `OSM_NODES_DATA_PATH` | `./data/kolkata_nodes.csv` | |
| `OSM_EDGES_DATA_PATH` | `./data/kolkata_edges.csv` | |
| `BATCH_WINDOW` | `300ms` | Adjustable 200–4000ms for velocity balancer. |

### Surge — `cmd/surge`

Streaming supply aggregator, demand aggregator, and optional surge
calculator. Supply fed by `driver.state.changed`, demand fed by
`order.created`, calculated surge updates emitted as `surge.zone.updated`.

| Env var | Default | Notes |
| --- | --- | --- |
| `KAFKA_BROKERS` | `localhost:19092` | |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` | |
| `SURGE_CITY_PREFIX` | `KOL` | |
| `SURGE_TRACKED_CELLS` | empty | Comma-separated H3 cells. Required for the calculator to publish. |

### Pricing — `cmd/pricing`

Consumes `surge.zone.updated` and maintains a thread-safe in-memory
surge multiplier read model.

| Env var | Default | Notes |
| --- | --- | --- |
| `KAFKA_BROKERS` | `localhost:19092` | |
| `PRICING_GROUP_ID` | `pricing-service-consumer-group` | |
| `REDIS_CLUSTER_ADDRS` | `localhost:6379` | Note: legacy name; others use `REDIS_CLUSTER_NODES`. |

### Reconciler — `cmd/reconciler`

Self-healing background repair loop. Detects dispatch state that
drifted after partial failures and reconciles it.

| Env var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | |
| `KAFKA_BROKERS` | `localhost:19092` | |
| `CITY_PREFIX` | `KOL` | |

### Pruner — `cmd/expiry`

> Note: pruner is the stale-telemetry worker; expiry is a separate
> offer-timeout janitor — see below.

`cmd/pruner` removes stale telemetry and availability state. Hardcoded
Kolkata zone list by default.

| Env var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` | |
| `REDIS_IP_MAP` | empty | |

### Expiry — `cmd/expiry`

`cmd/expiry` runs `OfferTimeoutJanitor` to time out unaccepted offers
and transition them back to `EXPIRED` so the order can be re-matched.

| Env var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | |
| `REDIS_CLUSTER_NODES` | `redis-node-1:6379` | |
| `KAFKA_BROKERS` | `kafka-broker:9092` | |
| `CITY_PREFIX` | `KOL` | |

### Rebalancer — `cmd/rebalancer`

`cmd/rebalancer` periodically scans idle drivers and emits
`RebalancePrompt` events so the dispatcher can redistribute them to
underserved cells.

| Env var | Default | Notes |
| --- | --- | --- |
| `REDIS_CLUSTER_NODES` | `redis-node-1:6379` | |
| `CITY_PREFIX` | `KOL` | |

### Gateway — `cmd/gateway` (BFF / public API)

JWT-authenticated HTTP/WebSocket BFF. Sits between clients (rider app,
admin portal, driver app) and the internal services. Routes:

- `/api/v1/auth/*` — login, refresh, role check
- `/api/v1/orders/*` — order CRUD and state
- `/api/v1/dispatch/*` — operational stats and rebalancer controls
- `/api/v1/trips/*` — active trip waypoint stream
- `/api/v1/analytics/*` — heatmap SSE
- `/ws` — WebSocket fan-out (driver.location, order.assigned, trip state)
- `/api/v1/admin/*` — admin portal (auth, trip, pricing, incident)

Region routing via `SUPPORTED_REGIONS_MATRIX` (e.g. `KOL,BLR`); client
can pass `X-Region` header or `?region=` query. Unrecognized regions
are rejected.

| Env var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | |
| `REDIS_CLUSTER_NODES` | `redis-node-1:6379` | |
| `KAFKA_BROKERS` | `kafka-broker:9092` | |
| `HTTP_PORT` | `8080` | |
| `JWT_SECRET_SIGNING_KEY` | dev value | **Override in production.** |
| `SUPPORTED_REGIONS_MATRIX` | `KOL,BLR` | Comma-separated region list. |

### Notification — `cmd/notification`

Outbox-pattern push notification engine. Reads the `outbox_events`
table, fans out to FCM (Android) and APNs (iOS) providers, marks rows
as delivered.

| Env var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | |
| `FCM_PROJECT_ID` | empty | Required to enable FCM. |
| `APNS_KEY_ID` | empty | Required to enable APNs. |
| `APNS_TEAM_ID` | empty | |

### Analytics — `cmd/analytics`

Live spatial heatmap SSE stream. Subscribes to driver state changes,
maintains a per-cell density grid, exposes `/api/v1/analytics/heatmap`
as a Server-Sent Events stream.

| Env var | Default | Notes |
| --- | --- | --- |
| `KAFKA_BROKERS` | `kafka-broker:9092` | |
| `CITY_PREFIX` | `KOL` | |
| `ANALYTICS_PORT` | `8089` | |

### Simulator — `cmd/simulator`

Local telemetry + order simulator. Streams synthetic driver positions
and orders to exercise the full pipeline.

### OSM Preprocessor — `cmd/osm-preprocessor`

Converts an OSM PBF extract into the local routing CSV format consumed
by `internal/routing`. See `DOC/README-LOCAL-ROUTING.md`.

### Migrate — `cmd/migrate`

Standalone migration runner using `golang-migrate`. Migrations also
auto-run on `cmd/dispatch` boot.

## Frontend Apps

### `frontend/` — Admin Control Room

Vite + React 18 + Tailwind dashboard for fleet ops, pricing control,
incident response, and live heatmap.

```powershell
cd frontend
npm install
npm run dev
```

Vite dev server proxies `/api` and `/ws` to the gateway (see
`vite.config.ts`).

### `client-app/` — Driver Mobile App

Next.js 16 + Capacitor 8 + Zustand driver-side app. WebSocket-first
with 4-second GPS interpolation, resilient reconnection, and a
SlideToConfirm gesture flow.

```powershell
cd client-app
npm install
npm run dev          # web
npx cap sync android # build + sync for Android
```

> **Note:** This project uses Next.js 16, which has breaking changes
> from earlier majors. Always check `node_modules/next/dist/docs/`
> before writing client-app code.

## Data Layer

### Postgres schema

The single source of truth is `database/migrations/`. Key tables:

- `drivers` — driver profile, status, current H3 cell
- `orders` — order lifecycle (`CREATED → ASSIGNED → EN_ROUTE_TO_PICKUP → DELIVERING → COMPLETED` / `CANCELLED` / `EXPIRED`)
- `dispatch_match_logs` — append-only audit ledger of every match decision
- `outbox_events` — outbox pattern rows for the notification engine
- `ledger_entries` — double-entry bookkeeping for financial settlement

State transitions are enforced by `verify_order_state_transition()`.

### Redis H3 spatial index

H3 resolution 8 cells. Sorted-set keys:

- `driver:location:{city_prefix}:{h3_cell}` — ZSET of driver IDs by last-seen timestamp
- `driver:{city_prefix}:{driver_id}:status` — current state
- `surge:matrix:{city_prefix}` — current surge multipliers per cell
- `pricing:cache:{city_prefix}` — shared distributed pricing cache

The `cmd/pruner` worker evicts entries older than 30s.

### Kafka topics

KRaft mode, no ZooKeeper. Topics:

| Topic | Producer | Consumer | Partition key |
| --- | --- | --- | --- |
| `driver.location.updated` | ingestion | analytics, surge | `city_prefix` |
| `driver.state.changed` | dispatch, ingestion | surge, gateway | `city_prefix` |
| `order.created` | gateway (or external) | dispatch, surge, analytics | `city_prefix` |
| `order.assigned` | dispatch | gateway, notification | `city_prefix` |
| `order.cancelled` | gateway, admin | dispatch, reconciler | `city_prefix` |
| `surge.zone.updated` | surge (calculator) | pricing, gateway | `city_prefix` |
| `rebalance.prompt` | rebalancer | dispatch | `city_prefix` |
| `trip.waypoint` | dispatch | gateway, analytics | `trip_id` |

### ML models (Triton)

XGBoost models in `model_repository/`:

- `xgboost_spatial_corrector` — corrects raw ETA from the local road graph using live spatial features
- `cancellation_risk_classifier` — predicts per-driver cancellation risk, feeds the matcher cost function

Both are exposed via the `GRPCInferenceService` proto. The
`internal/intelligence` package wraps Triton with a multi-tier
circuit breaker so the matcher falls back gracefully when Triton is
unhealthy.

## Deployment

### Docker Compose (local dev)

The `docker-compose.yml` brings up the full mesh: Postgres+PostGIS,
Kafka (KRaft), 6-node Redis cluster, Triton, db-migrator, and 11
deployable Go services (dispatch, ingestion, surge, pricing, reconciler,
pruner, expiry, rebalancer, gateway, notification, analytics).

### Helm chart (production)

`deploy/charts/drivers-for-u/` ships templates for dispatch, ingestion,
pricing, pruner, reconciler, surge deployments and services.

```powershell
helm lint deploy/charts/drivers-for-u
helm install drivers-for-u deploy/charts/drivers-for-u -n dispatch --create-namespace
```

### KEDA autoscaling

`deploy/keda-scaler.yaml` scales the dispatch and surge consumers on
Kafka consumer-group lag.

### Prometheus alerts

`deploy/prometheus-alerts.yaml` defines the production SLO alert rules
(see Milestone 10 for context).

### Local Kubernetes topology

`deploy/local/local-dev-topology.yaml` is a self-contained manifest
for spinning up Postgres, Kafka, and the Redis cluster inside a
local k8s cluster (e.g. Docker Desktop, kind, minikube):

```powershell
kubectl apply -f deploy/local/local-dev-topology.yaml
powershell -ExecutionPolicy Bypass -File .\bin\start-port-forwards.ps1
```

## Testing

| Layer | Command | Notes |
| --- | --- | --- |
| Matcher unit | `go test .\internal\dispatch\matcher` | Pure-Go, no infra. |
| Surge formula | `go test .\internal\surge\calculator -run TestSurgeCalculatorEngine_FormulaMath` | |
| Pricing | `go test .\internal\pricing\service` | |
| Spatial scanner | `go test .\internal\dispatch\repository` | Needs Redis. |
| Broad integration | `go test .\internal\test\...` | Needs full stack. |
| E2E | `powershell -ExecutionPolicy Bypass -File .\run_e2e_test.ps1` | Drives gateway + matrix + chaos. |
| Frontend (admin) | `cd frontend && npm test` | Jest. |
| Mobile (client) | `cd client-app && npm run lint` | ESLint + Next typecheck. |

The chaos test harness (Milestone 12) injects faults into Kafka,
Redis, and Postgres to verify reconciler, pruner, and circuit-breaker
fallback behavior. The integration test binary is built as
`integration.test.exe` (55 MB).

## Observability

| Surface | Where | Notes |
| --- | --- | --- |
| Prometheus metrics | `http://localhost:8080/metrics` (dispatch), `:8089/metrics` (analytics) | |
| Liveness | `http://localhost:8080/health` | |
| Readiness | `http://localhost:8080/ready` | DB, Redis, Kafka checks. |
| Dispatch stats | `http://localhost:8080/api/v1/dispatch/stats` | |
| OpenTelemetry traces | `internal/observability/tracing` | Distributed context propagation across Kafka (header carrier). |
| Health server | `internal/observability/server` | Shared `HealthServer` used by every service. |
| Circuit breaker | `sony/gobreaker v2` | Per-dependency. |

## Multi-Region

The gateway uses `internal/gateway/middleware/region.go` to attach a
region to every request. The `RegionRouter` detects and routes
cross-region handoffs; cross-region handoffs flow through the
`HandoffConsumer` and emit `order.handoff.requested` /
`order.handoff.completed` events.

Supported regions: `KOL` (Kolkata) and `BLR` (Bengaluru). Configure
`SUPPORTED_REGIONS_MATRIX` to add more.

## Milestones

All 34 currently-completed milestones:

| # | Milestone |
| --- | --- |
| 2 | Live Feature Hydration |
| 3 | Request Re-Queuing & Recovery Paths |
| 4 | Shared Distributed Pricing Cache |
| 5 | Standalone E2E Simulation Runner |
| 6 | City-Scale OpenStreetMap Routing Ingestion |
| 7 | Stale Telemetry Pruner Daemon |
| 8 | Dynamic Batching Window Adaptation (Marketplace Velocity Balancer) |
| 9 | Post-Crash Order State Reconciliation Sync Worker |
| 10 | Prometheus Alert Topographies & SLA Metrics |
| 11 | Schema-Migration Instrumentation & Database Seeding |
| 12 | Chaos Engineering and Fault-Injection Testing Harness |
| 13 | End-to-End Local Kubernetes Deployment via Helm Charts |
| 14 | The Public API Gateway & BFF Architecture Layer |
| 15 | Edge Security Tier (JWT + Distributed Redis Sliding-Window Rate Limiting) |
| 16 | Graceful WebSocket Connection Draining & Reconnect Handshaking |
| 17 | Driver Acceptance, Expiry, and Rejection Lifecycle |
| 18 | Distributed Context Propagation & Async Observability (OpenTelemetry) |
| 19 | Live Spatial Fleet Analytics & Dynamic Heatmap Streaming |
| 20 | The Active Trip Execution Lifecycle & Live Waypoint Streaming |
| 21 | Immutable Financial Settlement & Double-Entry Bookkeeping Ledger |
| 22 | Multi-Region Federation & Shared-Nothing Edge Partitioning |
| 23 | Full-Lifecycle E2E Automated Integration & Telemetry Load Testing |
| 24 | Asynchronous Outbox Push Notification Layer (FCM / APNs) |
| 25 | Third-Party Fiat Payment Gateway & Webhook Reconciliation Engine |
| 26 | Frontend Mobile Client Networking Core & Resilient Reconnection |
| 27 | Centralized Operations Control Room Dashboard Panel (Admin Portal) |
| 28 | Local Environment Streamlining & Unified Orchestration Startup |
| 28b | Closed-Loop Dynamic Surge Pricing & Triton ML Backpressure Circuit Breaking |
| 29 | Global Active-Active Cross-Region Handoff & Boundary Hydration |
| 30 | Premium Operations Portal Authentication Overlay |
| 31 | Lightweight Client-Side Protobuf Stream Decoder & Binary WS Framing |
| 32 | Full-Stack Network Integration & Mocking Suite |
| 33 | System Administrator Authorization Tier & Relational Database Seeding |
| 34 | Dynamic Geofencing & Operational Zone Management, Algorithmic Force-Match, & Telemetry Fraud Risk Isolation Radar (Marketplace Orchestrator) |

## Driver Partner App Blueprint

This section captures the full driver-side product surface for mobile and
backend developers. Treat implemented items as current behavior and unwired
items as requirements for future tickets.

### 1. App Entry & Authentication

#### 1.1 Splash / Launch Screen

- Show logo and tagline: `Drive with [Brand]`.
- Auto-check auth token, KYC status, online/offline state, app version.
- Route to `/login` or `/driver` based on auth and driver state.

#### 1.2 Login / Signup

Route: `/login`

- Driver mode toggle.
- Fields: phone number, OTP, optional email fallback, password.
- Buttons: `Send OTP`, `Login`, `Sign up as Driver`, `Continue with Google`.
- Logs captured: login timestamp, device ID, IP, app version, geo-location.

#### 1.3 Driver Registration Flow

Route: `/driver-onboarding`

- Step 1, Personal: full name, DOB, gender, profile photo, languages spoken.
- Step 2, Address: permanent address, current address, city of operation.
- Step 3, Documents: driving license front/back, Aadhaar or ID, PAN, police verification certificate, address proof.
- Step 4, Vehicle Expertise: manual, automatic, both, years of experience.
- Step 5, Bank Details: account number, IFSC, holder name, UPI ID, cancelled cheque upload.
- Step 6, Emergency Contact: name, relation, phone.
- Step 7, Agreement: terms, privacy, partner agreement, digital signature.
- Step 8, Training Quiz: safety and etiquette quiz, pass required.
- Buttons per step: `Upload`, `Next`, `Back`, `Save & Exit`, `Submit for Verification`.
- Logs captured: each document upload timestamp, verification status changes, admin reviewer ID.

### 2. Driver Home / Duty Dashboard

Route: `/driver`

#### 2.1 Top Bar

- Hamburger menu opens the driver drawer.
- Driver name, photo, and rating.
- Connection state indicator: `CONNECTED` or `RECONNECTING`.
- Notification bell with unread count.
- SOS button always visible in red.

#### 2.2 Center Map View

- Stylized live map with driver's current location pin.
- High-demand zone heatmap.
- Nearby drivers as ambient map context.
- Pickup and drop pins when on trip.

#### 2.3 Bottom Duty Pane

- Large `Go Online` / `Go Offline` toggle.
- Today's snapshot: trips count, earnings, online hours, acceptance rate.
- `Simulate incoming booking (demo)` button with bell icon.
- Quick links: Earnings, Profile, Support, Payouts.
- Heatmap legend toggle.
- Vehicle selector for multi-vehicle drivers.
- Preferred trip type filter: City, Outstation, Both.

#### 2.4 Home Screen States

- `OFFLINE`: greyed map and only `Go Online` call to action.
- `ONLINE_IDLE`: searching animation and heatmap visible.
- `OFFER_PENDING`: incoming booking popup.
- `MATCHED_EN_ROUTE_TO_PICKUP`: navigation pane.
- `ARRIVED_AT_PICKUP`: OTP capture pane.
- `DELIVERING`: trip-in-progress pane.
- `COMPLETED`: final bill pane.

### 3. Incoming Booking Popup

State: `OFFER_PENDING`

- Modal sheet over `/driver`.
- 15-second countdown ring.
- Rider name and rating.
- Pickup distance and pickup ETA.
- Pickup address and drop address.
- Trip type: In-city Round, One-way, Mini-outstation, Outstation.
- Car type requested and transmission required.
- Estimated fare, estimated distance, estimated duration.
- D4M Care badge when rider opted in.
- Special notes from rider, including luggage, pets, and other constraints.
- Buttons: `Accept` as green slide-to-accept, `Decline` as grey secondary action.
- Decline behavior: 30-second cooldown and reason picker.
- Decline reasons: Too far, Break, Vehicle issue, Other.
- Logs captured: offer received timestamp, accepted/declined timestamp, decline reason, response latency.

### 4. En Route to Pickup

Pane on route: `/driver`

- Turn-by-turn navigation through Google Maps or Mapbox.
- Rider card: name, photo, rating, masked phone, in-app chat.
- Buttons: `Call rider`, `Chat`, `Navigate (open Maps)`, `I've arrived`, `Cancel trip`.
- Cancel reasons: Rider no-show, Wrong address, Vehicle breakdown, Safety, Other.
- Live ETA shared with rider.
- Logs captured: route polyline, GPS pings every 5 seconds, time-to-arrive.

### 5. Arrived at Pickup

- Auto-send `Arrived` notification to rider.
- Start 5-minute free wait timer.
- After free wait, start waiting charge at INR 2 per minute.
- Mandatory speedometer capture: start KM odometer reading, fuel level from 0 to 100 percent or E/F gauge.
- Optional recommended capture: dashboard photo.
- Ride OTP entry: 4-digit OTP from rider to verify passenger.
- Buttons: `Verify OTP & Start Trip`, `Report no-show`.
- Logs captured: arrival timestamp, wait minutes, start KM, fuel percent, OTP attempts.

### 6. Trip In Progress

State: `DELIVERING`

- Live map with route and driver position glide animation.
- Trip timer in `HH:MM:SS` format.
- Distance counter.
- Collapsible rider info card.
- Buttons: `Navigate`, `Call rider`, `Add stop`, `Report issue`, `SOS`, `Slide to End Trip`.
- Mid-trip events: toll added, parking added, waiting added.
- Logs captured: GPS trail, speed samples, idle time, route deviations.

### 7. End Trip & Final Bill

#### 7.1 End Trip Dialog

- Dialog title: `End this trip?`
- Buttons: `Keep driving`, `Yes, end trip`.

#### 7.2 End Speedometer Capture

- End KM.
- End fuel percent.
- Dashboard photo.

#### 7.3 Final Bill Screen

- Package base, for example `INR 800 / 8h / 100km`.
- Extra KM rate.
- Overtime hours and rate, for example `INR 50`.
- Night charge, for example `INR 50` or `INR 100`.
- Waiting charge.
- Toll, parking, surge.
- D4M Care fee.
- Total amount.
- Payment method display: Cash, UPI, Card, Wallet.
- Buttons: `Mark paid (Cash)`, `Confirm UPI received`, `Send payment link`, `Request rider rating`.

#### 7.4 Post-Trip

- Rate the rider from 1 to 5.
- Rider rating tags: polite, on-time, and related tags.
- Tip received display.
- Buttons: `Go back online`, `Take a break`.

### 8. Driver Account

Route group: `/driver-account`

Layout: sidebar or tabs.

#### 8.1 Profile

Route: `/driver-account/profile`

- Photo, name, rating, total trips.
- Bio editor.
- Transmission expertise badges.
- KYC document list with statuses: Verified, Pending, Missing.
- `Upload new document` button.
- Languages, vehicle list, service cities.

#### 8.2 Earnings

Route: `/driver-account/earnings`

- Range selector: Today, Week, Month, Custom.
- Gross earnings card.
- Breakdown: trips, tips, bonuses, incentives, deductions, commission, GST.
- Net payout.
- Recent trips list with time, from/to, amount.
- Download statement as PDF or CSV.
- Annual tax summary.

#### 8.3 Payouts

Route: `/driver-account/payouts`

- Available balance.
- Linked bank account with change action.
- UPI ID.
- Withdraw amount input and `MAX` shortcut.
- `Request payout` button for instant or next-day payout.
- Payout history list.
- Auto-payout schedule toggle.

#### 8.4 Support

Route: `/driver-account/support`

- FAQ accordion.
- Live chat with support.
- Raise ticket form with category, description, attachment.
- Emergency hotline one-tap call.
- Ticket history with status.

#### 8.5 Trip History

Route: `/driver-account/trip-history`

- Filterable list of all trips.
- Per trip: map replay, fare breakdown, rider rating given/received, dispute button.

#### 8.6 Incentives & Bonuses

Route: `/driver-account/incentives`

- Active quests, for example `Complete 10 trips - INR 500`.
- Progress bars.
- Surge zones map.
- Referral program.

#### 8.7 Vehicle Management

Route: `/driver-account/vehicles`

- Vehicle list with make, model, plate, RC, insurance, PUC.
- Document expiry alerts.
- Add/remove vehicle.

#### 8.8 Performance / Ratings

Route: `/driver-account/performance`

- Overall rating, acceptance rate, cancellation rate, completion rate.
- Compliments breakdown.
- Recent rider reviews.
- Tier badge: Bronze, Silver, Gold, Platinum.
- Tier perks.

#### 8.9 Settings

Route: `/driver-account/settings`

- Language.
- Notifications.
- Ride preferences.
- Default navigation app.
- Dark mode.
- Biometric login.
- Change password.
- Logout.
- Delete account.

#### 8.10 Wallet

Route: `/driver-account/wallet`

- In-app wallet balance for tolls, fuel cards, and related expenses.
- Add money.
- Transaction history.

#### 8.11 Training & Certifications

Route: `/driver-account/training`

- Modules: safety, etiquette, EV, premium-car.
- Quiz scores.
- Certificates earned.

### 9. Notifications Center

Route: `/driver-account/notifications`

- Tabs: All, Trips, Earnings, Promotions, System.
- Mark all read.
- Swipe to dismiss.
- Logs captured: push delivery, open, action taken.

### 10. Hamburger Drawer Navigation

Drawer order:

```text
Profile
Go Online toggle
Trip History
Earnings
Payouts
Incentives
Vehicle
Performance
Wallet
Notifications
Support
Training
Refer a friend
Settings
Logout
```

### 11. Safety & Emergency

- SOS button always visible.
- SOS action: call 112, alert support, share live location with emergency contact.
- Trip share link auto-generated for every ride.
- Optional dashcam integration.
- Fatigue monitor: after 10 continuous hours, enforce a mandatory 6-hour break.
- Women-driver safety mode with night-time geofencing alerts.

### 12. Suggested Additional Features

1. Fuel and maintenance tracker: log refuels and service reminders by KM.
2. Smart heatmap predictions: AI-driven `go here in 15 min` guidance.
3. Voice-controlled accept/decline for hands-free safety.
4. Co-driver mode for long outstation trips.
5. Offline mode caching so a trip can continue if the network drops.
6. Earnings goal tracker with daily target and progress ring.
7. Insurance and claims in-app filing.
8. Driver community/forum for peer chat.
9. EV-specific features: charging-station map and battery percentage.
10. Multi-language voice navigation.
11. Pet, luggage, and wheelchair acknowledgement before accept.
12. Daily pre-trip vehicle inspection checklist.
13. Auto-tax estimator for GST/TDS monthly planning.
14. Loyalty redemption store for tyres and service discounts.
15. Geofenced auto-online when entering a city.
16. Driver-to-driver tip jar and SOS mesh for nearby driver alerts.
17. In-app fuel-card and toll-tag top-up.
18. Trip replay video combining dashcam and map.
19. Auto-cancel protection with compensation if rider cancels late.
20. Health and insurance perks dashboard.

### 13. Per-Trip Audit Trail

- Offer timestamps: received, accepted/declined, reason.
- Driver GPS trail: lat, lng, speed, heading every 5 seconds.
- KM start/end.
- Fuel start/end.
- Dashboard photos.
- OTP attempts.
- Wait time.
- Idle time.
- Route deviations.
- Fare breakdown components.
- Payment method and confirmation.
- Ratings exchanged.
- Cancellations and reason.
- Device, app version, network type, battery percent.

### 14. Complete Route Map

```text
/login
/driver-onboarding
/driver
/driver-account
/driver-account/profile
/driver-account/earnings
/driver-account/payouts
/driver-account/support
/driver-account/trip-history
/driver-account/trip-history/$tripId
/driver-account/incentives
/driver-account/vehicles
/driver-account/performance
/driver-account/wallet
/driver-account/notifications
/driver-account/settings
/driver-account/training
/driver-account/refer
/sos
```

## Rider App Blueprint

This section captures the full rider-side product surface for car owners who
need a driver from the platform. Treat implemented items as current behavior
and unwired items as requirements for future tickets.

### 1. App Entry & Authentication

#### 1.1 Splash / Launch Screen

- Show logo and tagline: `Your car. Our driver.`
- Auto-check auth token, profile completion, active or ongoing trip, location permission, and app version.
- Redirect unauthenticated users to `/login`.
- Redirect active trips to `/rider/trip/$tripId/live`.
- Redirect all other valid sessions to `/rider`.

#### 1.2 Login / Signup

Route: `/login`

- Fields: phone number with country code, 6-digit OTP.
- Buttons: `Send OTP`, `Resend OTP`, `Verify & Continue`.
- Resend OTP cooldown: 30 seconds.
- Social buttons: `Continue with Google`, `Continue with Apple`.
- Links: Terms of Service, Privacy Policy.
- New-user navigation: `/onboarding`.
- Returning-user navigation: `/rider`.

#### 1.3 Rider Onboarding

Route: `/onboarding`

- Step 1, Personal Info: full name, email, optional gender, optional DOB, profile photo.
- Step 2, Add First Car: make, model, year, car type, transmission, fuel type, registration plate, color, optional insurance expiry.
- Step 2 can be skipped.
- Step 3, Home & Work Addresses: save both as favorites.
- Step 4, Emergency Contacts: up to 3 contacts with name and phone.
- Step 5, Notification Permissions: push, SMS, email toggles.
- Step 6, Location Permission: prefer `Always`, fallback to `While using app`.
- Buttons: `Skip`, `Back`, `Next`, `Finish`.

### 2. Home / Booking Screen

Route: `/rider`

#### 2.1 Top Bar

- Left action: hamburger or profile avatar opens `/account`.
- Center action: current city or location chip, tap to change city.
- Right actions: notification bell with badge links to `/account/notifications`, SOS shortcut.

#### 2.2 Map View

- Live rider location pin.
- Nearby available drivers as animated car icons.
- ETA halo, for example `Drivers in 3 min`.
- Recenter button.
- Zoom controls.

#### 2.3 Booking Card

Bottom sheet, swipe-up expandable.

- Trip type tabs: In-City Round Trip, In-City One-Way, Mini Outstation, Outstation.
- Mini Outstation duration baseline: 8 hours.
- Outstation duration baseline: multi-day.
- Pickup field: auto-filled to current location, editable.
- Pickup button: `Use current location`.
- Drop field: optional for hourly, required for one-way and outstation.
- Add stop action: `+`, up to 3 stops.
- Saved place chips: Home, Work, Recents.
- Schedule controls: `Now` toggle, `Schedule for later` with date and time picker.
- Duration control: slider from 1 to 24 hours for in-city trips.
- Outstation duration control: slider from 1 to 7 days.
- Car selector default: user's default garage car, badged `Your Car`.
- `Book for another car` opens a car picker.
- Garage car picker: list of garage cars with radio selection.
- One-time car form: make, model, car type, transmission.
- Car confirmations: Hatchback, Sedan, SUV, Premium, Manual, Automatic.
- Persons stepper: 1 to 8.
- Promo code input with `Apply` button.
- Promo result states: green check or red error.
- D4M Care add-on toggle with info modal.
- D4M Care display price: INR 49.
- D4M Care coverage copy: ride insurance, trip monitoring, premium support.
- Payment method pill row: Cash, UPI, Card, Wallet.
- Payment method change route: `/account/payments`.
- Fare estimate strip: base fare, night charge, Care charge, surge multiplier, total.
- Night charge applies for 22:00 to 06:00.
- `Fare breakdown` opens a modal.
- Primary CTA: `Book Driver`.
- `Book Driver` triggers dispatch.

#### 2.4 Quick Tiles

Shown above the booking card in collapsed view.

- My Garage shortcut.
- Last trip `Rebook`.
- Offers banner.
- Refer & Earn banner.

### 3. Dispatch & Driver Matching

#### 3.1 Searching Driver Screen

Route: `/rider/dispatch`

- Animated radar or pulsing pin.
- Copy: `Finding a driver near you`.
- Countdown timer, typically 60 seconds.
- Trip summary chip.
- Button: `Cancel search`.
- Cancellation rule: no fee within 30 seconds.

#### 3.2 Driver Assigned Modal

- Driver photo, name, rating, total trips.
- Transmission expertise badge: Manual, Automatic, Both.
- ETA to pickup with minutes and kilometers.
- Vehicle context copy, for example `Driving your Maruti Swift`.
- Buttons: `Call driver`, `Chat driver`, `Share trip`, `Cancel ride`.
- Driver call uses masked phone.
- Cancel ride shows policy.

#### 3.3 No Driver Found

- Copy: `No drivers available right now`.
- Buttons: `Retry`, `Schedule for later`, `Increase radius`.

### 4. Live Trip Screen

Route: `/rider/trip/$tripId/live`

#### 4.1 Map & Status Banner

- Statuses: driver moving toward pickup, driver arrived, OTP shared, trip started, en route, trip ending.
- Live ETA.
- Distance covered.
- Optional current speed.

#### 4.2 Trip Header Card

- Status pill: Arriving, Arrived, In Trip.
- Driver mini-card with photo, name, rating, vehicle plate.
- Action icons: Call, Chat, Share trip, SOS.

#### 4.3 OTP Display

Before trip start:

- Large 4-digit OTP.
- Copy: `Share this with your driver to start the trip`.
- Copy button.

#### 4.4 Trip Details Card

Expandable card:

- Pickup, stops, drop.
- Trip type.
- Duration booked.
- Car selected.
- Fare estimate with live updates.
- Promo.
- Care add-on.
- Payment method.

#### 4.5 In-Trip Actions

- Add a stop.
- Change drop location.
- Extend duration for hourly trips.
- Report issue for driver behavior, route, or safety.
- SOS calls emergency contact and support, then shares live location.
- Share trip through WhatsApp, SMS, or copy link.
- Share trip link opens the public live tracking page.

#### 4.6 Trip Timeline

Collapsible timeline:

```text
Booked at
Driver assigned
Driver arrived
Trip started
Stop 1
Trip ended
```

### 5. End-of-Trip & Payment

#### 5.1 Final Bill Screen

Route: `/rider/trip/$tripId/bill`

- Trip summary: distance, duration, stops, waiting time, night hours.
- Bill breakdown: base fare, distance covered, extra KM, time charges, overtime, night charges, D4M Care charge, surge, promo discount, wallet credits, taxes, GST, total payable.
- Payment method with change action before paying.
- CTA: `Pay Now`.
- Payment outcomes: cash collected, UPI launched, card charged, wallet debited.
- After payment, generate invoice.

#### 5.2 Rate Driver Screen

Route: `/rider/trip/$tripId/rate`

- 5-star rating.
- Positive tag chips: Polite, Safe Driving, Knew Routes, Punctual, Clean.
- Issue tag chips: Rash Driving, Late, Rude.
- Tip selector: INR 0, INR 20, INR 50, INR 100, Custom.
- Optional comments, 500 character limit.
- Buttons: `Submit`, `Skip`.

#### 5.3 Trip Receipt / Invoice

- Downloadable PDF.
- Email receipt.
- `Report a problem with this trip` action.

### 6. Account Drawer / Menu

Route group: `/account`

Drawer order:

```text
Profile
My Garage
Bookings / Trip History
Payments & Methods
Wallet
Promos & Offers
Refer & Earn
Saved Places
Emergency Contacts
Insurance & Care
Notifications
Support / Help
Settings
Legal
Logout
```

### 7. Account Pages

#### 7.1 Profile

Route: `/account/profile`

- Photo upload.
- Name, email, phone with verified badge, DOB, gender, preferred language.
- KYC level indicator: Basic, Verified.
- Buttons: `Edit`, `Save`, `Verify Email`, `Change Phone`.

#### 7.2 My Garage

Route: `/account/garage`

- Car list with make/model, type, transmission, default star.
- Per-car actions: `Set Default`, `Edit`, `Delete`, `Upload RC`, `Upload Insurance docs`.
- Add Car form: make, model, year, type, transmission, fuel, plate, color, insurance expiry, set as default.
- Car types: Hatchback, Sedan, SUV, Premium.
- Document slots: RC, Insurance, PUC.
- Document expiry alerts.

#### 7.3 Bookings / Trip History

Route: `/account/bookings`

- Tabs: Upcoming, Ongoing, Completed, Cancelled.
- Filters: date range, trip type, car.
- Trip card fields: route, date, fare, driver, status.
- Trip detail route: `/account/bookings/$tripId`.
- Trip detail content: map route, timeline, bill, driver, receipt download, rebook, report issue, missed rating action.

#### 7.4 Payments & Methods

Route: `/account/payments`

- Saved cards with last 4 digits, expiry, brand.
- Card actions: Add, Remove, Set default.
- UPI IDs with add/remove actions.
- Linked wallets, for example Paytm.
- Cash toggle, always available.
- Auto-pay setting.
- Billing address for invoices.

#### 7.5 Wallet

Route: `/account/wallet`

- Balance.
- Add money presets: INR 100, INR 500, INR 1000, Custom.
- Transactions list for credits, debits, refunds.
- Cashback history.

#### 7.6 Promos & Offers

Route: `/account/rewards`

- Active offer cards.
- Apply code field.
- Expired offers collapsed.
- Loyalty tier: Silver, Gold, Platinum.
- Tier perks.

#### 7.7 Refer & Earn

Route: `/account/refer`

- Referral code.
- Share buttons: WhatsApp, SMS, Copy, More.
- Referral status list: Pending, Joined, First trip done, Rewarded.
- Earnings summary.

#### 7.8 Saved Places

Route: `/account/places`

- Home, Work, custom labels.
- Add, edit, delete.
- Address search and map pin selection.

#### 7.9 Emergency Contacts

Route: `/account/emergency`

- Contact list, maximum 3.
- Add, edit, delete.
- Toggle: auto-share trip with contacts.

#### 7.10 Insurance & Care

Route: `/account/insurance`

- D4M Care subscription modes: one-time per trip, monthly plan.
- Active coverage details.
- Past claims.
- `File a claim` button.

#### 7.11 Notifications

Route: `/account/notifications`

- Inbox list with trip, promo, system categories.
- Mark read.
- Delete.
- Preferences: push, SMS, email per category.

#### 7.12 Support / Help

Route: `/account/support`

- Categories: Trip issue, Payment, Account, Driver behavior, Lost item, Other.
- Recent trips issue flow: select trip, issue type, message.
- Live chat.
- Call support.
- FAQ articles.
- Ticket history with open/closed status.
- Ticket detail route: `/account/support/ticket/$ticketId`.

#### 7.13 Settings

Route: `/account/settings`

- Language.
- Theme: System, Light, Dark.
- Distance units.
- Currency.
- App permissions: location, notifications, contacts.
- Connected accounts: Google, Apple.
- Data and privacy: download data, delete account.
- App version, build, check for updates.

#### 7.14 Legal

Route: `/account/legal`

- Terms of Service.
- Privacy Policy.
- Cancellation Policy.
- Refund Policy.
- Licenses.

### 8. Safety Features

- SOS button on home and live trip.
- SOS calls 112.
- SOS alerts emergency contacts with live location, trip details, and driver details.
- SOS notifies support.
- Trip sharing produces a public live-tracking link that expires after the trip.
- Driver verification badge visible before the ride.
- Ride Check detects anomalies such as long stop or off-route movement.
- Ride Check prompt copy: `Everything ok?`.
- Women Safety mode: female-preferred drivers and auto-share with contacts after 22:00.

### 9. Notifications

Push, SMS, and email triggers:

- OTP login.
- Driver assigned, arriving, arrived.
- Trip started, ended, cancelled.
- Payment success, failed, refund.
- Promo offers.
- Surge alerts.
- Scheduled trip reminder 1 hour before pickup.
- Document expiry for RC, insurance, PUC.
- Rate your driver.
- Referral milestones.
- Support ticket updates.

### 10. Suggested Additional Features

1. Favorite Drivers: request same driver again and maintain blocked driver list.
2. Subscription Plans: monthly driver hours pack at discount.
3. Corporate / Business Profile: separate billing, GST invoices, admin dashboard.
4. Multi-car booking: book 2 drivers simultaneously for family events or similar cases.
5. Driver pre-assignment for scheduled trips, assigned 30 minutes before pickup.
6. Voice Booking, for example `Book a driver for tomorrow 9 AM`.
7. Apple/Google Wallet pass for upcoming trips.
8. In-app tips and training videos for handing over the car safely.
9. Car Health Logger so the driver can flag mechanical issues after a trip.
10. Carbon footprint tracker per trip.
11. Festive themes and seasonal promos.
12. Accessibility mode with larger text, screen reader support, and color-blind palette.
13. Offline mode for active trip and past invoice viewing without internet.

### 11. Navigation Map

```text
/login
/onboarding
/rider
/rider/dispatch
/rider/trip/$tripId/live
/rider/trip/$tripId/bill
/rider/trip/$tripId/rate
/account
/account/profile
/account/garage
/account/bookings
/account/bookings/$tripId
/account/payments
/account/wallet
/account/rewards
/account/refer
/account/places
/account/emergency
/account/insurance
/account/notifications
/account/support
/account/support/ticket/$ticketId
/account/settings
/account/legal
/sos
/share/$publicTripId
```

## App Backend Connectivity Contract

Every Rider and Driver app route in the blueprints above must be backed by a
real service boundary before it is treated as production behavior. Mock-only
UI state is allowed for demos, but it must be marked as demo code and must not
be the final integration path.

### Existing Backend Spine

| App capability | Backend connection |
| --- | --- |
| Rider login | `POST /api/v1/auth/rider/login` on `cmd/gateway`; returns a JWT with `RIDER` role. |
| Driver login | `POST /api/v1/auth/driver/login` on `cmd/gateway`; returns a JWT with `DRIVER` role. |
| Fare estimate | `GET /api/v1/pricing/quote?h3_cell=...&base_fare_paise=...`; reads the surge matrix through `internal/pricing/service`. |
| Rider booking | `POST /api/v1/orders`; writes `orders`, emits `order.created`, then dispatch consumes the Kafka event. |
| Driver matching | `cmd/dispatch` consumes `order.created`, scans Redis H3 cells, evaluates matcher strategy, writes assignment state, and emits `order.assigned`. |
| Live assignment/trip updates | `GET /api/v1/dispatch/stream?order_id=...` WebSocket; gateway fans out `order.assigned` via Redis pub/sub. |
| Driver accept | `POST /api/v1/dispatch/accept`; moves order from `ASSIGNED` to `EN_ROUTE_TO_PICKUP` and stores active trip lease in Redis. |
| Driver decline | `POST /api/v1/dispatch/decline`; rolls order back to `CREATED`, frees driver, applies cooldown, and requeues `order.created`. |
| Arrived at pickup | `POST /api/v1/trip/arrive`; moves order to `ARRIVED_AT_PICKUP`. |
| Start trip | `POST /api/v1/trip/start`; moves order to `DELIVERING` and driver to `ONLINE_DELIVERING`. |
| Complete trip | `POST /api/v1/trip/complete`; moves order to `COMPLETED`, returns driver to available state, and writes ledger entries. |
| Driver telemetry | `cmd/ingestion` gRPC `ClientStreamPositions`; writes Postgres telemetry, Redis H3 availability, and Kafka `driver.location.updated`. |
| Heatmap analytics | `cmd/analytics` exposes `/api/v1/analytics/heatmap` over SSE. |
| Push notifications | `cmd/notification` consumes `notification_outbox` and uses `user_device_tokens`. |
| Payment reconciliation | `POST /api/v1/payments/webhook`; updates `payment_intents`, `orders`, and `financial_ledger_entries`. |
| Admin recovery and controls | `cmd/gateway` admin routes for ledger, trip recovery, geofence, fraud lockout, force-match, pricing freeze, and order cancellation. |

### Required Rider API Surface

These Rider pages must connect to backend APIs before production release:

| Rider area | Required backend connection |
| --- | --- |
| `/onboarding` | `rider_profiles`, first car, addresses, emergency contacts, notification preferences, and location-permission audit endpoints. |
| `/rider` booking form | Garage read API, saved places API, quote API, promo validation API, D4M Care pricing API, payment-method read API, and order creation API. |
| `/rider/dispatch` | Order status polling or WebSocket subscription, search cancellation API, retry API, and search-radius adjustment API. |
| `/rider/trip/$tripId/live` | Authenticated trip detail API, live WebSocket stream, OTP read API, share-link API, add-stop API, change-drop API, extend-duration API, issue-report API. |
| `/rider/trip/$tripId/bill` | Final fare API, payment intent API, wallet debit API, cash confirmation API, invoice generation API. |
| `/rider/trip/$tripId/rate` | Driver rating API, tip API, rider comment moderation/audit API. |
| `/account/profile` | Rider profile read/update, email verification, phone change workflow. |
| `/account/garage` | Car CRUD, default car mutation, RC/insurance/PUC upload, expiry alerts. |
| `/account/bookings` | Trip history list/detail, receipt download, rebook, dispute/report issue. |
| `/account/payments` | Saved cards, UPI IDs, linked wallets, billing address, auto-pay setting. |
| `/account/wallet` | Balance, top-up intent, transaction history, refunds, cashback. |
| `/account/rewards` | Promo catalog, promo redemption, expired offers, loyalty tier. |
| `/account/refer` | Referral code, referral status, reward ledger. |
| `/account/places` | Saved place CRUD with geocoding and map pin persistence. |
| `/account/emergency` | Emergency contact CRUD and auto-share preference. |
| `/account/insurance` | D4M Care plan, coverage status, claim filing, claim history. |
| `/account/notifications` | Notification inbox, mark-read/delete, channel preferences. |
| `/account/support` | Ticket create/list/detail, attachment upload, live chat, call-support event logging. |
| `/account/settings` | Preferences, permissions audit, connected accounts, data export, delete account. |
| `/account/legal` | Versioned legal document registry and acceptance audit. |
| `/sos` | Global SOS API that calls emergency workflow, support escalation, and live-location sharing. |
| `/share/$publicTripId` | Public trip tracking token, expiry policy, read-only live location stream. |

### Required Driver API Surface

These Driver pages must connect to backend APIs before production release:

| Driver area | Required backend connection |
| --- | --- |
| `/driver-onboarding` | Driver profile, address, KYC document uploads, vehicle expertise, bank details, emergency contact, agreement signature, quiz score, admin review audit. |
| `/driver` duty dashboard | Duty-state API, vehicle selector API, trip preference API, heatmap SSE, dispatch WebSocket, driver telemetry stream, online/offline audit. |
| Incoming offer popup | WebSocket/push offer payload, offer lease countdown, accept API, decline API, decline reason, response-latency audit. |
| En route to pickup | Trip detail API, masked call/chat API, route/ETA service, arrive API, cancel API with reason. |
| Arrived at pickup | Arrival API, wait timer API, start odometer/fuel capture API, photo upload, OTP verification/start API, no-show API. |
| Trip in progress | Live waypoint upload, add-stop API, issue report API, toll/parking/waiting event API, SOS API, complete-trip API. |
| Final bill | End odometer/fuel capture, final fare API, payment confirmation, invoice/settlement API, rider rating request. |
| `/driver-account/profile` | Driver profile, KYC status, languages, vehicles, service cities, document upload. |
| `/driver-account/earnings` | Earnings summary, trip ledger, deductions, tax statement, PDF/CSV export. |
| `/driver-account/payouts` | Available balance, bank/UPI update, payout request, payout history, auto-payout schedule. |
| `/driver-account/support` | FAQ, ticket create/list/detail, attachment upload, live chat, emergency hotline audit. |
| `/driver-account/trip-history` | Driver trip history, map replay, fare breakdown, dispute, rider rating. |
| `/driver-account/incentives` | Quest catalog, progress, surge zones, referral program. |
| `/driver-account/vehicles` | Vehicle CRUD, RC/insurance/PUC documents, expiry alerts. |
| `/driver-account/performance` | Ratings, acceptance, cancellation, completion, compliments, tier/perks. |
| `/driver-account/settings` | Language, notifications, ride preferences, nav app, theme, biometric login, password, logout, delete account. |
| `/driver-account/wallet` | Driver wallet balance, top-up, transaction history, toll/fuel-card integrations. |
| `/driver-account/training` | Training modules, quiz results, certification status. |
| `/driver-account/notifications` | Driver inbox, mark-read/delete, delivery/open/action logs. |
| `/driver-account/refer` | Referral code, referral status, rewards. |

### Current Frontend Wiring Gaps To Close

| Gap | Required fix |
| --- | --- |
| Rider login client path points to `/api/v1/auth/login` | Change the Rider client to call `/api/v1/auth/rider/login`, or add a gateway alias intentionally. |
| SOS page calls `/api/v1/driver/sos` | Add a gateway SOS endpoint and support workflow, or change the client to the final global SOS route. |
| Driver accept uses hardcoded `http://localhost:8080` | Route all client calls through `API_GATEWAY_BASE_URL` / `NEXT_PUBLIC_API_GATEWAY`. |
| Driver decline is local UI state | Wire decline to `POST /api/v1/dispatch/decline` with reason and audit metadata. |
| Driver arrive/start/complete screens are partly local state | Wire them to `/api/v1/trip/arrive`, `/api/v1/trip/start`, and `/api/v1/trip/complete`. |
| Account, wallet, garage, KYC, documents, payouts, support, ratings, and settings pages are mostly static UI | Create backend APIs, database tables, and service ownership for each page before production. |
| WebSocket usage is inconsistent | Standardize on `GET /api/v1/dispatch/stream?order_id=...` plus bearer/JWT auth and remove incompatible `?jwt=`-only usage. |
| Trip photos and documents have no storage contract | Add object storage, signed upload URLs, virus/content checks, metadata tables, and retention policy. |
| Promo, D4M Care, tips, final fare line items, and subscription plans need financial contracts | Extend pricing/payment/ledger models before these are exposed to users. |

## Wiring Risks (current)

| Risk | Why it matters |
| --- | --- |
| `REDIS_CLUSTER_NODES` vs `REDIS_CLUSTER_ADDRS` | Pricing uses the legacy name; standardizing is open. |
| `SURGE_TRACKED_CELLS` gates surge publication | Calculator publishes nothing when empty; supply/demand workers still run. |
| Driver availability is dual-written | Telemetry (ingestion) and assignment (dispatch) both touch Redis. Stale telemetry can re-index an already-assigned driver if eviction lags. |
| `driver.location.updated` is integration-only | Not on the pricing critical path. |
| Hungarian matching is CPU-heavy at high concurrency | The 300ms `BATCH_WINDOW` cap mitigates but doesn't eliminate fan-out cost. |
| OSM PBF input vs checked-in CSVs | `cmd/osm-preprocessor` reads PBF; dispatch loads CSVs. Drift is possible. |
| External infrastructure for full E2E | Kafka, Redis Cluster, Postgres, and Triton must all be healthy for end-to-end behavior. |
| Region matrix is hardcoded | New regions need a code change in the gateway. |
| Product blueprints exceed current API coverage | Rider and Driver account pages, documents, payouts, support, ratings, and SOS still need dedicated backend APIs. |
| Client route mismatch | The Rider login page calls `/api/v1/auth/login`, but the gateway exposes `/api/v1/auth/rider/login`. |
| SOS route is not registered | The client calls `/api/v1/driver/sos`, but the gateway has no matching route yet. |

## Deeper Documentation

| Document | Purpose |
| --- | --- |
| `DOC/ARCHITECTURE_BREAKDOWN_FOR_TEAM.md` | Package/community breakdown and runtime data flow. |
| `DOC/Driver_Delivery_Platform_Architecture.md` | Earlier high-level architecture narrative. |
| `DOC/ENTERPRISE_SYSTEMS_BLUEPRINT.md` | Full enterprise blueprint with diagrams. |
| `DOC/PRODUCTION_BLUEPRINT.md` | Production hardening and operational blueprint. |
| `DOC/README-LOCAL-ROUTING.md` | OSM routing data preparation and dispatch routing integration. |
| `DOC/STATE_ARCHITECTURE_AND_WEBSOCKET_INTEGRATION.md` | WebSocket-first state model and live waypoint streaming. |
| `DOC/UBER_LIKE_UI_UX_DESIGN_GUIDE.md` | Frontend design system reference. |
| `DOC/walkthrough.md` | End-to-end walkthrough of the assignment flow. |

For deep codebase queries, the project ships a knowledge graph at
`graphify-out/`. Run `graphify query "<question>"` (or
`graphify explain "<concept>"` / `graphify path A B`) before
grepping raw source. Run `graphify update .` after modifying code.

## License

Internal platform — see your platform's standard terms.
