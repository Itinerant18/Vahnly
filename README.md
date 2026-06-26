# Vahnly

[![Go](https://img.shields.io/badge/Go-1.25-blue?logo=go&style=flat-square)](https://go.dev)
[![Postgres](https://img.shields.io/badge/Postgres-15%20%2B%20PostGIS-blue?logo=postgresql&style=flat-square)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.2%20Cluster-red?logo=redis&style=flat-square)](https://redis.io)
[![Kafka](https://img.shields.io/badge/Kafka-KRaft-orange?logo=apachekafka&style=flat-square)](https://kafka.apache.org)
[![License](https://img.shields.io/badge/License-Internal-lightgrey?style=flat-square)](#license)

Vahnly is a real-time driver-dispatch platform for a **rider-owns-car** model: the rider
owns the vehicle and the platform dispatches a professional driver to drive it (in-city,
hourly, outstation, or monthly). It is not point-to-point ride-hailing, so the driver
travels a **first-mile leg** to the owner's car, pricing is by **duration/package**, and a
large share of bookings are **scheduled**.

The Go backend ingests driver telemetry over gRPC, indexes spatial availability in Redis H3
cells, matches orders with a Hungarian/Greedy optimizer (Triton XGBoost ETA correction with
graceful fallback), streams events over Kafka, and serves a JWT-authenticated gateway with
WebSocket fan-out to the rider, driver, and admin apps. Launch region: **Kolkata (KOL)**.

> New here? Start with [SETUP.md](./SETUP.md) (clean clone → running stack). Agent rules in
> [AGENTS.md](./AGENTS.md).

---

## Runtime path

```text
[ Driver app ] --gRPC--> cmd/ingestion --> Redis (H3 ZSETs) + Postgres
                                   |
                                   v  Kafka: driver.location.updated
            +----------------------+----------------------+
            v                      v                      v
        cmd/surge            cmd/analytics          (booking) cmd/gateway
   surge.zone.updated      SSE heatmap -> admin     Kafka: order.created
            |                                              |
            v                                              v
        cmd/pricing                                   cmd/dispatch (Hungarian | Greedy)
   (in-memory quotes)                          internal/routing (CH road graph)
                                               internal/intelligence (Triton ETA)
                                                     |
                                                     v  Kafka: order.assigned
                                               cmd/gateway (WS BFF) -> Rider/Driver app
```

---

## Quickstart (Docker Compose)

Brings up Postgres+PostGIS, Kafka (KRaft), a 6-node Redis cluster, Triton, the db-migrator,
and the Go services. Run from the repo root.

```bash
docker compose down -v
docker compose up -d --build

# once healthy (~30s)
go run ./cmd/migrate      # apply migrations
go run ./cmd/simulator    # synthetic fleet + orders (optional)
```

---

## Repository map

| Path | Role |
| :--- | :--- |
| [`cmd/ingestion`](./cmd/ingestion) | gRPC gateway ingesting driver GPS streams. |
| [`cmd/dispatch`](./cmd/dispatch) | Order matching (Hungarian / Greedy) + Triton ETA, with fallback. |
| [`cmd/surge`](./cmd/surge) · [`cmd/pricing`](./cmd/pricing) | Supply/demand surge metrics → in-memory pricing cache. |
| [`cmd/gateway`](./cmd/gateway) | Public JWT gateway: auth, orders, trips, WS live updates. |
| [`cmd/reconciler`](./cmd/reconciler) · [`cmd/pruner`](./cmd/pruner) · [`cmd/expiry`](./cmd/expiry) · [`cmd/rebalancer`](./cmd/rebalancer) | Self-healing, stale-GC, offer-expiry, idle-driver rebalancing workers. |
| [`cmd/notification`](./cmd/notification) | Outbox push worker (FCM / APNs). |
| [`cmd/analytics`](./cmd/analytics) | Spatial heatmap SSE for the admin control room. |
| [`cmd/migrate`](./cmd/migrate) · [`cmd/simulator`](./cmd/simulator) · [`cmd/osm-preprocessor`](./cmd/osm-preprocessor) | Migrations runner, load simulator, OSM→road-graph preprocessor. |
| [`internal/`](./internal) | Domain logic, repositories, adapters. |
| [`rider-app/`](./rider-app) · [`client-app/`](./client-app) | Next.js 16 + Capacitor rider and driver apps. |
| [`frontend/`](./frontend) | Admin control dashboard (Vite + React). |
| [`database/migrations/`](./database/migrations) | PostgreSQL schema migrations. |
| [`model_repository/`](./model_repository) | Triton models (XGBoost ETA + cancellation classifiers). |
| [`deploy/`](./deploy) | Helm charts, local k8s topology, KEDA + Prometheus specs. |

Each service reads `DATABASE_URL`, `REDIS_CLUSTER_NODES`, `KAFKA_BROKERS`. Notable extras:
`cmd/dispatch` `ALGORITHM_STRATEGY` (HUNGARIAN|GREEDY) + `TRITON_SERVER_URL` (empty = fallback);
`cmd/gateway` `JWT_SECRET_SIGNING_KEY` + `SUPPORTED_REGIONS_MATRIX` (default `KOL`).

---

## Data layer

- **Postgres** — `orders` state machine
  (`CREATED → ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → WAITING → DELIVERING →
  COMPLETED` / `CANCELLED`), plus `drivers`, `regional_cities` (geofence + operating hours +
  supported tiers), `outbox_events`, and a double-entry `ledger_entries`.
- **Redis** — H3 res-8 spatial index: `drivers:zset:{city}:{cell}` (availability),
  `driver:{city:id}:profile` (hash), surge/pricing caches.
- **Kafka** — event bus, keyed by `city_prefix`:

| Topic | Producer | Consumers |
| :--- | :--- | :--- |
| `driver.location.updated` | ingestion | analytics, surge |
| `order.created` | gateway | dispatch, surge, analytics |
| `order.assigned` | dispatch | gateway, notification |
| `surge.zone.updated` | surge | pricing, gateway |
| `rebalance.prompt` | rebalancer | dispatch |

Triton (`internal/intelligence`) is wrapped in a `sony/gobreaker` circuit breaker — on
timeout/crash, dispatch fails over to raw graph ETAs.

---

## Deployment

- **Backend (prod):** the GCP VM `dfu-stack` runs the Go services from source via
  `docker compose up -d --build`. CD: a push to `main` touching backend paths runs **Backend
  CI**, which on success triggers the **VM Deploy** workflow (SSH → `git pull` + rebuild +
  boot-migrate).
- **Frontends:** rider/driver apps on Firebase Hosting (`firebase deploy`); admin via the
  admin pipeline.
- **K8s (optional):** `helm install vahnly deploy/charts/vahnly -n dispatch --create-namespace`;
  KEDA scales `cmd/dispatch`/`cmd/surge` on Kafka lag (`deploy/keda-scaler.yaml`).

---

## Testing

| Command | Scope |
| :--- | :--- |
| `go test ./...` | Backend unit + integration (some suites need a live Redis). |
| `cd rider-app && npm run lint && npx tsc --noEmit && npm test` | Rider app. |
| `cd client-app && npm ci && npm run lint && npm test` | Driver app. |
| `cd frontend && npm test` | Admin dashboard. |

CI runs Backend / Rider App / Driver App / Admin per-area on `main`. Health: `GET /health`
(liveness), `GET /ready` (DB + Redis + Kafka). Prometheus on each service `/metrics`.

---

## Documentation

Deep-dives live in [`DOC/`](./DOC): architecture
([ARCHITECTURE_BREAKDOWN_FOR_TEAM.md](./DOC/ARCHITECTURE_BREAKDOWN_FOR_TEAM.md)), routing
([README-LOCAL-ROUTING.md](./DOC/README-LOCAL-ROUTING.md)), production hardening
([PRODUCTION_BLUEPRINT.md](./DOC/PRODUCTION_BLUEPRINT.md)), and WebSocket/state
([STATE_ARCHITECTURE_AND_WEBSOCKET_INTEGRATION.md](./DOC/STATE_ARCHITECTURE_AND_WEBSOCKET_INTEGRATION.md)).
Design tokens + app design system: [client-app/design.md](./client-app/design.md).

---
3 live sites (all 200):

┌────────┬──────────────────────────────┐
│  App   │            URL               │
├────────┼──────────────────────────────┤
│ Rider  │ <https://rider.aniket.site>  │
├────────┼──────────────────────────────┤
│ Driver │ <https://driver.aniket.site> │
├────────┼──────────────────────────────┤
│ Admin  │ <https://admin.aniket.site>  │
└────────┴──────────────────────────────┘

## License

Internal platform. Copyright © Vahnly. All rights reserved.
