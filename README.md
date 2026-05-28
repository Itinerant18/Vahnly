# Drivers-for-u

Real-time driver delivery dispatch platform written in Go. The system ingests driver telemetry, maintains spatial availability in Redis, matches orders to drivers, updates Postgres state, emits Kafka events, computes surge multipliers, and exposes pricing read models.

This README is a current developer orientation snapshot. For deeper architecture notes, see the `DOC/` files listed near the end.

## Current Snapshot

Observed with the code review graph on 2026-05-28:

| Area           | Current value |
| -------------- | ------------- |
| Files in graph | 52 |
| Graph nodes | 323 |
| Graph edges | 2,873 |
| Main languages | Go, SQL, Bash, PowerShell |
| Main service entrypoints | `cmd/ingestion`, `cmd/dispatch`, `cmd/surge`, `cmd/pricing`, `cmd/reconciler`, `cmd/pruner`, `cmd/simulator`, `cmd/osm-preprocessor` |

High-level runtime path:

```text
driver telemetry
  -> cmd/ingestion gRPC
  -> internal/telemetry
  -> Postgres + Redis H3 driver indexes + Kafka driver.location.updated
  -> cmd/dispatch consumes order.created
  -> internal/dispatch matcher + routing ETA + optional Triton correction
  -> Postgres order/driver updates + Redis driver eviction + Kafka order.assigned
  -> Kafka driver.state.changed / order.created
  -> cmd/surge supply, demand, and calculator workers
  -> Kafka surge.zone.updated
  -> cmd/pricing in-memory multiplier read model
```

## Repository Map

| Path | Role |
| --- | --- |
| `api/proto/v1` | Protobuf API contract for telemetry ingestion. |
| `pkg/api/v1` | Generated Go protobuf and gRPC bindings. |
| `cmd/ingestion` | Driver telemetry gRPC service bootstrap. |
| `cmd/dispatch` | Order matching engine bootstrap with metrics and health endpoints. |
| `cmd/surge` | Supply, demand, and surge calculator stream workers. |
| `cmd/pricing` | Pricing service bootstrap that maintains a surge multiplier read model. |
| `cmd/reconciler` | Dispatch reconciliation daemon for stuck or incomplete assignments. |
| `cmd/pruner` | Stale telemetry cleanup worker for Redis/Postgres driver availability state. |
| `cmd/simulator` | Local telemetry simulator for development and tests. |
| `cmd/osm-preprocessor` | OSM PBF to local routing CSV preprocessor. |
| `internal/telemetry` | Telemetry ingestion domain, repositories, gRPC handler, and use case. |
| `internal/dispatch` | Matching consumer, matching algorithms, spatial scanner, and reconciliation logic. |
| `internal/routing` | Local road graph loader and contraction-hierarchy-style ETA service. |
| `internal/intelligence` | Triton ETA correction client and ETA adapter. |
| `internal/surge` | Supply aggregation, demand aggregation, and surge multiplier calculation. |
| `internal/pricing` | Order pricing service and surge multiplier cache. |
| `internal/events` | Shared event payload contracts used across services. |
| `internal/observability` | Prometheus metrics, health/readiness server, and circuit breaker helpers. |
| `internal/test` | Integration-oriented test helpers and end-to-end test coverage. |
| `data` | Local routing datasets for Kolkata road graph experiments. |
| `model_repository` | Triton model repository for ETA correction. |
| `deploy` | Kubernetes-oriented manifests and alerts. |
| `docker-compose.yml` | Local infrastructure stack for Postgres, Kafka, Redis Cluster, Triton, and reconciler. |
| `schema.sql` | Database schema and seed structure for local Postgres. |

## Main Services

### Ingestion

`cmd/ingestion` starts the driver telemetry gRPC gateway. It writes the latest driver telemetry to Postgres, indexes available drivers into Redis H3 sorted sets, and emits `driver.location.updated`.

Important env vars:

| Variable | Default |
| --- | --- |
| `GRPC_PORT` | `50051` |
| `DATABASE_URL` | local Postgres connection string |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` |
| `KAFKA_BROKERS` | `localhost:19092` |
| `REDIS_IP_MAP` | empty |

### Dispatch

`cmd/dispatch` consumes `order.created`, finds nearby available drivers, evaluates matches, persists assignments, evicts assigned drivers from Redis, emits `order.assigned`, and emits `driver.state.changed`.

Important env vars:

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | local Postgres connection string |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` |
| `KAFKA_BROKERS` | `localhost:19092` |
| `ALGORITHM_STRATEGY` | `HUNGARIAN` |
| `TRITON_SERVER_URL` | `127.0.0.1:8001` |
| `METRICS_PORT` | `8080` |
| `OSM_NODES_DATA_PATH` | `./data/kolkata_nodes.csv` |
| `OSM_EDGES_DATA_PATH` | `./data/kolkata_edges.csv` |

### Surge

`cmd/surge` runs the streaming supply aggregator, demand aggregator, and optional surge calculator. Supply is fed by `driver.state.changed`; demand is fed by `order.created`; calculated surge updates are emitted as `surge.zone.updated`.

Important env vars:

| Variable | Default |
| --- | --- |
| `KAFKA_BROKERS` | `localhost:19092` |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` |
| `SURGE_CITY_PREFIX` | `KOL` |
| `SURGE_TRACKED_CELLS` | empty |

Set `SURGE_TRACKED_CELLS` to a comma-separated H3 cell list when you want the calculator loop to publish zone updates.

### Pricing

`cmd/pricing` consumes `surge.zone.updated` and keeps a thread-safe in-memory surge multiplier cache. It is currently a pricing service runtime/read model, not a public HTTP fare quote gateway.

Important env vars:

| Variable | Default |
| --- | --- |
| `KAFKA_BROKERS` | `localhost:19092` |
| `PRICING_GROUP_ID` | `pricing-service-consumer-group` |
| `REDIS_CLUSTER_ADDRS` | `localhost:6379` |

Note: most services use `REDIS_CLUSTER_NODES`; pricing currently uses `REDIS_CLUSTER_ADDRS`.

### Reconciler

`cmd/reconciler` runs a background repair loop for dispatch state that can drift after partial failures.

Important env vars:

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | local Postgres connection string |
| `KAFKA_BROKERS` | `localhost:19092` |
| `CITY_PREFIX` | `KOL` |

### Pruner

`cmd/pruner` removes stale telemetry and availability state. The current bootstrap tracks a small hardcoded Kolkata zone list.

Important env vars:

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | local Postgres connection string |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` |
| `REDIS_IP_MAP` | empty |

## Local Development

Prerequisites:

| Tool | Purpose |
| --- | --- |
| Docker Desktop | Local Postgres, Kafka, Redis Cluster, Triton. |
| Go | Build and run services. Match the repo toolchain in `go.mod`. |
| PowerShell | Existing local helper scripts are PowerShell-first. |

Common local ports:

| Port | Service |
| --- | --- |
| `5432` | Postgres/PostGIS |
| `19092` | Kafka external listener |
| `6379`-`6384` | Redis Cluster |
| `50051` | Telemetry gRPC |
| `8000`-`8002` | Triton HTTP/gRPC/metrics |
| `8080` | Dispatch health, readiness, metrics, and stats |

Start infrastructure:

If using **Docker Compose**:
```powershell
cd C:\workspace\Driver
docker-compose up -d
```

If using **Kubernetes (Local Dev)**:
To deploy the PostgreSQL, Kafka, and Redis Cluster stack inside a local Kubernetes cluster:
```powershell
# 1. Deploy K8s resources into the 'dispatch' namespace
kubectl apply -f deploy/local/local-dev-topology.yaml

# 2. Run the port-forward helper to bind service ports locally
powershell -ExecutionPolicy Bypass -File .\bin\start-port-forwards.ps1
```

Load the standard local environment:

If using **Docker Compose**:
```powershell
. .\bin\run-local-env.ps1
$env:REDIS_CLUSTER_ADDRS = $env:REDIS_CLUSTER_NODES
```

If using **Kubernetes (Local Dev)**:
Set the environment variables printed by the `start-port-forwards.ps1` script:
```powershell
$env:REDIS_IP_MAP = "<IP_MAP_FROM_SCRIPT>"
$env:DATABASE_URL = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379"
$env:KAFKA_BROKERS = "localhost:19092"
```

Database Migrations:

On boot, the `dispatch` service automatically executes programmatic schema migrations. To run migrations manually at any time:
```powershell
go run .\cmd\migrate
```

Run services in separate terminals as needed (ensure env vars are set in each terminal):

```powershell
go run .\cmd\ingestion
go run .\cmd\dispatch
$env:SURGE_TRACKED_CELLS = "88754cb247fffff,88283473fffffff"; go run .\cmd\surge
go run .\cmd\pricing
go run .\cmd\reconciler
go run .\cmd\pruner
go run .\cmd\simulator
```

## Observability

`cmd/dispatch` exposes the local operations endpoints:

| Endpoint | Purpose |
| --- | --- |
| `http://localhost:8080/health` | Basic liveness. |
| `http://localhost:8080/ready` | Dependency readiness for database, Redis, and Kafka. |
| `http://localhost:8080/metrics` | Prometheus scrape endpoint. |
| `http://localhost:8080/api/v1/dispatch/stats` | Dispatch operational stats. |

Kubernetes-oriented scaler and alert examples live in `deploy/`.

## Routing Data

Dispatch loads local road graph data from:

```text
data/kolkata_nodes.csv
data/kolkata_edges.csv
```

If those files are present, dispatch loads them into the routing graph. If they are missing, dispatch falls back to a tiny in-memory seed graph so the service can still boot.

To regenerate routing CSVs, place the expected OSM PBF input under `data/` and run:

```powershell
go run .\cmd\osm-preprocessor
```

See `DOC/README-LOCAL-ROUTING.md` for the routing pipeline details.

## Verification

Run targeted unit tests:

```powershell
go test .\internal\dispatch\matcher
go test .\internal\surge\aggregator .\internal\pricing\service
go test .\internal\surge\calculator -run TestSurgeCalculatorEngine_FormulaMath
```

Run broader integration checks after Docker infrastructure is healthy:

```powershell
go test .\internal\test\...
powershell -ExecutionPolicy Bypass -File .\run_e2e_test.ps1
```

Some tests require Kafka, Redis Cluster, Postgres, or Triton. If H3-backed dispatch packages fail on Windows, verify that Go, `GOARCH`, Cgo, and the MinGW toolchain are aligned with the team setup.

## Current Wiring Risks

The largest gaps to keep in mind when developing against this repo:

| Risk | Why it matters |
| --- | --- |
| Pricing has no public quote API yet | `cmd/pricing` maintains the multiplier read model, but clients still need an exposed fare quote surface. |
| `SURGE_TRACKED_CELLS` controls surge publication | Supply and demand workers can run while the calculator publishes nothing if no tracked cells are configured. |
| Telemetry and dispatch both affect driver availability | Assigned-driver Redis eviction exists, but driver state transitions must stay aligned so later telemetry does not re-index unavailable drivers incorrectly. |
| `driver.location.updated` is currently mostly an integration output | It is emitted by ingestion, but the core local pricing path does not depend on it yet. |
| Hungarian matching can create high fan-out work | Batch matching evaluates many order-driver combinations and can stress CPU/latency under large windows. |
| Environment names are not fully standardized | Most services use `REDIS_CLUSTER_NODES`; pricing uses `REDIS_CLUSTER_ADDRS`. |
| Local routing input path can drift | `cmd/osm-preprocessor` expects its configured PBF input, while checked-in CSVs are what dispatch consumes by default. |
| End-to-end correctness still depends on external infrastructure | Kafka topics, Redis Cluster, Postgres schema, and Triton availability are required for full-system behavior. |

## Deeper Documentation

| Document | Purpose |
| --- | --- |
| `DOC/ARCHITECTURE_BREAKDOWN_FOR_TEAM.md` | Package/community breakdown and runtime data-flow notes. |
| `DOC/Driver_Delivery_Platform_Architecture.md` | Earlier high-level architecture narrative. |
| `DOC/PRODUCTION_BLUEPRINT.md` | Production hardening and operational blueprint. |
| `DOC/README-LOCAL-ROUTING.md` | OSM routing data preparation and dispatch routing integration. |
| `DOC\ASSIGNMENT_FLOW.md` | Assignment workflow details. |
| `DOC\OPS_ACCEPTANCE_CHECKLIST.md` | Operational readiness checklist. |
