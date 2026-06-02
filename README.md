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
| Pricing still lacks a public quote endpoint | The gateway reads cached surge; final fare quote endpoint is still on the roadmap. |

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
