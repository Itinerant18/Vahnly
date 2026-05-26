# Driver Delivery Platform — Complete Production Blueprint

> **Version:** 2.0 · **Date:** May 2026 · **Classification:** Internal Engineering  
> **Module:** `github.com/platform/driver-delivery` · **Language:** Go 1.26.3  
> **SLA:** < 500 ms end-to-end dispatch latency · **Scale Target:** 10K–100K active drivers · **Cities:** 10+

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Layout](#2-repository-layout)
3. [Technology Stack](#3-technology-stack)
4. [Infrastructure Blueprint](#4-infrastructure-blueprint)
5. [Service Architecture](#5-service-architecture)
6. [Data Flow & Event Pipeline](#6-data-flow--event-pipeline)
7. [Database Design](#7-database-design)
8. [Redis Spatial Index Design](#8-redis-spatial-index-design)
9. [Kafka Topic Topology](#9-kafka-topic-topology)
10. [The Three-Phase Matching Engine](#10-the-three-phase-matching-engine)
11. [Surge Pricing Pipeline](#11-surge-pricing-pipeline)
12. [ML Intelligence Layer (Triton)](#12-ml-intelligence-layer-triton)
13. [gRPC API Contracts](#13-grpc-api-contracts)
14. [Configuration & Environment Variables](#14-configuration--environment-variables)
15. [Local Development Setup](#15-local-development-setup)
16. [Testing Strategy](#16-testing-strategy)
17. [Scalability Model](#17-scalability-model)
18. [Resilience & Failure Modes](#18-resilience--failure-modes)
19. [Production Hardening Checklist](#19-production-hardening-checklist)
20. [Glossary](#20-glossary)

---

## 1. System Overview

The Driver Delivery Platform is a **real-time, event-driven microservices system** that matches delivery orders to available drivers across multiple cities. It implements the **three-phase Uber-pattern dispatch algorithm** adapted for driver-delivery logistics.

### Core Design Principle

> **Surge pricing is a feature. Dispatch matching is the platform.**  
> The surge pricing pipeline is built entirely as a consumer of the dispatch event stream — at near-zero additional infrastructure cost.

### System Capabilities

| Capability | Detail |
|---|---|
| Driver scale | 10,000 – 100,000 concurrent active drivers |
| Cities | 10+ geofenced regions |
| Dispatch latency SLA | < 500 ms (order created → driver assigned) |
| Location update rate | ~1 update / 4 seconds per driver |
| Matching batch window | 200–400 ms or 150 orders, whichever first |
| Surge pricing refresh | Every 30 seconds per H3 cell |
| Algorithm options | GREEDY / HUNGARIAN / AUCTION (runtime-configurable) |

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DRIVER MOBILE APP                           │
│                   gRPC Streaming (ClientStreamPositions)            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ location telemetry (stream)
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              LOCATION INGESTION SERVICE  (cmd/ingestion)            │
│   gRPC :50051 · pgxpool(50 conns) · Redis Cluster · Kafka Producer  │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │ ZSET write (H3 cell)             │ Produce
           ▼                                  ▼
┌──────────────────────┐          ┌───────────────────────────────────┐
│   REDIS CLUSTER 6x   │          │   KAFKA  (KRaft, 5 topics)        │
│  3 primary + 3 replica│         │   driver.location.updated         │
│  H3 spatial ZSETs    │          │   order.created                   │
│  surge demand/supply │          │   order.assigned                  │
│  surge matrix cache  │          │   driver.state.changed            │
└──────────┬───────────┘          │   surge.zone.updated              │
           │ SMEMBERS (k-ring)    └──────────┬────────────────────────┘
           ▼                                  │ Consume (order.created)
┌─────────────────────────────────────────────┼───────────────────────┐
│              DISPATCH MATCHING SERVICE  (cmd/dispatch)              │
│   Kafka Consumer · Spatial Scanner · CH Routing · Triton Client     │
│   pgxpool(10 conns) · GREEDY | HUNGARIAN | AUCTION strategy         │
└─────────────────────────────────────────────┼───────────────────────┘
           │ atomic DB write                  │ Produce (order.assigned)
           ▼                                  ▼
┌──────────────────────┐          ┌───────────────────────────────────┐
│   POSTGRESQL 15      │          │   SURGE PRICING PIPELINE          │
│   + PostGIS 3.3      │          │   Demand Aggregator               │
│   orders, drivers    │          │   Supply Aggregator               │
│   dispatch_logs      │          │   Surge Calculator                │
└──────────────────────┘          │   Order Pricing Service           │
                                  └───────────────────────────────────┘
                                                │ (optional)
                                                ▼
                                  ┌─────────────────────────┐
                                  │  TRITON INFERENCE SERVER │
                                  │  XGBoost ETA Corrector  │
                                  │  gRPC :8001             │
                                  └─────────────────────────┘
```

---

## 2. Repository Layout

```
C:\workspace\Driver\
│
├── api/proto/                          # Protobuf source definitions
│   ├── telemetry/v1/telemetry.proto    # LocationIngestionService RPC
│   └── triton/triton.proto             # Triton GRPCInferenceService RPC
│
├── bin/                                # Pre-compiled Windows binaries
│   ├── dispatch.exe
│   ├── ingestion.exe
│   └── simulator.exe
│
├── cmd/                                # Service entry points (main packages)
│   ├── dispatch/main.go                # Dispatch Matching Service
│   ├── ingestion/main.go               # Location Ingestion gRPC Service
│   └── simulator/main.go              # E2E smoke-test client
│
├── internal/                           # All business logic (not importable externally)
│   ├── dispatch/
│   │   ├── consumer/                   # Kafka order.created consumer + batch engine
│   │   ├── domain/                     # OrderCreatedPayload, MatchResult types
│   │   ├── matcher/                    # EvaluateGreedyMatch, EvaluateHungarianOptimization
│   │   └── repository/                 # SpatialScanner (Redis H3 SMEMBERS)
│   │
│   ├── telemetry/
│   │   ├── delivery/grpc/              # LocationIngestionHandler (gRPC stream handler)
│   │   ├── domain/                     # DriverLocation model
│   │   ├── repository/                 # RedisRepository (ZSET writes) + KafkaProducer
│   │   └── usecase/                    # H3 cell computation + pipeline orchestration
│   │
│   ├── routing/
│   │   └── graph/                      # ContractionHierarchiesService (CH algorithm)
│   │
│   ├── intelligence/
│   │   ├── client/                     # TritonClient (gRPC to Triton server)
│   │   └── usecase/                    # ETACorrectorUseCase (ML + fallback logic)
│   │
│   ├── surge/
│   │   ├── aggregator/                 # DemandAggregator + SupplyAggregator
│   │   └── calculator/                 # SurgeCalculatorEngine
│   │
│   ├── pricing/
│   │   └── service/                    # OrderPricingService (surge matrix sync)
│   │
│   └── test/                           # Internal E2E matching tests
│
├── pkg/api/                            # Generated protobuf Go code (do not edit)
│   ├── telemetry/v1/
│   └── triton/
│
├── model_repository/                   # Triton model files
│   └── xgboost_spatial_corrector/1/
│       └── config.pbtxt
│
├── deploy/local/                       # Local Kubernetes manifests + scripts
│   ├── local-dev-topology.yaml         # Full K8s manifest (Postgres, Kafka, Redis)
│   ├── start-local-infra.sh            # Bootstrap: apply + port-forward + export envs
│   └── teardown-local-infra.sh         # Cleanup all local K8s resources
│
├── test/integration/                   # Integration tests (require live infra)
│   └── dispatch_e2e_test.go
│
├── DOC/                                # Architecture documentation
│   ├── Driver_Delivery_Platform_Architecture.md
│   └── PRODUCTION_BLUEPRINT.md         # ← this file
│
├── schema.sql                          # PostgreSQL schema (DDL + triggers + indexes)
├── run_e2e_test.ps1                    # Windows E2E orchestration script
├── go.mod                              # Go module: github.com/platform/driver-delivery
└── go.sum
```

---

## 3. Technology Stack

### Core Runtime

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Language | Go | 1.26.3 | All services |
| API protocol | gRPC + Protocol Buffers v3 | grpc v1.81.1 | Telemetry ingestion, ML inference |
| Container runtime | Docker / Kubernetes | — | Local dev + production |
| ML inference | Triton Inference Server | — | XGBoost ETA correction |

### Data Stores

| Store | Technology | Version | Role |
|---|---|---|---|
| Relational DB | PostgreSQL + PostGIS | 15 + 3.3 | Orders, drivers, audit logs |
| Spatial cache | Redis Cluster | 7.2 | H3 driver index, surge demand/supply |
| Message bus | Apache Kafka (KRaft) | 7.5.0 | All async event communication |

### Key Go Dependencies

| Package | Version | Role |
|---|---|---|
| `github.com/jackc/pgx/v5` | v5.9.2 | PostgreSQL connection pool |
| `github.com/redis/go-redis/v9` | v9.19.0 | Redis Cluster client |
| `github.com/segmentio/kafka-go` | v0.4.51 | Kafka producer/consumer |
| `google.golang.org/grpc` | v1.81.1 | gRPC framework |
| `google.golang.org/protobuf` | v1.36.11 | Protocol Buffers runtime |
| `github.com/uber/h3-go/v3` | v3.7.1 | Uber H3 hexagonal spatial index |
| `go.uber.org/atomic` | v1.11.0 | Lock-free atomic counters |
| `golang.org/x/sync` | v0.20.0 | errgroup, semaphore |

---

## 4. Infrastructure Blueprint

### Kubernetes Manifests (`deploy/local/local-dev-topology.yaml`)

#### PostgreSQL — StatefulSet

```yaml
Kind:      StatefulSet
Replicas:  1
Image:     postgis/postgis:15-3.3
Port:      5432
Storage:   1Gi PVC
Init:      ConfigMap with schema.sql (auto-applied on first start)
Service:   ClusterIP postgres-service:5432
```

- PostGIS extension enabled for geospatial queries
- Schema applied via init container; includes all DDL, triggers, and indexes
- External port-forward: `localhost:5432 → postgres pod:5432`

#### Apache Kafka — StatefulSet (KRaft Mode)

```yaml
Kind:      StatefulSet
Replicas:  1
Image:     confluentinc/cp-kafka:7.5.0
Ports:     9092 (internal PLAINTEXT), 19092 (external PLAINTEXT_HOST)
Topics auto-created via Job (topic-seeder):
  - order.created         (partitions: 12, replication: 1)
  - order.assigned        (partitions: 12, replication: 1)
  - driver.location.updated (partitions: 24, replication: 1)
  - driver.state.changed  (partitions: 12, replication: 1)
  - surge.zone.updated    (partitions: 12, replication: 1)
Service:   ClusterIP kafka-service:9092
           NodePort   19092 (external)
```

- KRaft mode: no ZooKeeper dependency
- Topic-seeder Kubernetes Job ensures topics exist before consumers start

#### Redis Cluster — 6-Pod StatefulSet

```yaml
Kind:      StatefulSet (6 pods: redis-0 through redis-5)
Image:     redis:7.2-alpine
Topology:  3 primary shards + 3 replica shards
Bootstrap: redis-cluster-init Job (runs redis-cli --cluster create)
Service:   Headless (redis-cluster-headless) for DNS pod discovery
           ClusterIP redis-service:6379 (single-node proxy for testing)
```

- Hash slots 0–16383 split across 3 primaries
- Bootstrap job creates cluster using pod IPs resolved via headless DNS
- `REDIS_IP_MAP` env var maps pod IPs to localhost ports for development

### Infrastructure Bootstrap Sequence

```
Step 1:  kubectl apply -f local-dev-topology.yaml
Step 2:  kubectl rollout status statefulset/postgres
Step 3:  kubectl rollout status statefulset/kafka
Step 4:  kubectl rollout status statefulset/redis-cluster
Step 5:  Wait for redis-cluster-init Job completion
Step 6:  Wait for topic-seeder Job completion
Step 7:  kubectl port-forward svc/postgres-service  5432:5432
Step 8:  kubectl port-forward svc/kafka-service     19092:19092
Step 9:  kubectl port-forward pod/redis-0            6379:6379
         kubectl port-forward pod/redis-1            6380:6379
         kubectl port-forward pod/redis-2            6381:6379
Step 10: Export environment variables (DATABASE_URL, REDIS_CLUSTER_NODES, KAFKA_BROKERS)
```

---

## 5. Service Architecture

### Service 1: Location Ingestion Service (`cmd/ingestion/main.go`)

**Purpose:** Accept continuous GPS telemetry streams from driver mobile apps. Index driver positions into Redis for sub-millisecond spatial lookup.

**Startup Sequence:**
```
1. Parse env: GRPC_PORT, DATABASE_URL, REDIS_CLUSTER_NODES, KAFKA_BROKERS, REDIS_IP_MAP
2. Initialize pgxpool (MaxConns: 50, MinConns: 10, IdleTimeout: 15m)
3. Ping PostgreSQL — fatal if unreachable
4. Initialize Redis Cluster client (DialTimeout: 2s, R/W timeout: 500ms)
5. Ping Redis Cluster — fatal if unreachable
6. Wire dependency tree:
     RedisRepository → TelemetryUseCase
     KafkaProducer   → TelemetryUseCase
     TelemetryUseCase → LocationIngestionHandler (gRPC)
7. Start gRPC server on :50051 with keepalive tuning
8. Await SIGTERM/SIGINT → GracefulStop (15s deadline)
```

**gRPC Keepalive Configuration:**
```
MaxConnectionIdle:     15 minutes
MaxConnectionAge:      2 hours
MaxConnectionAgeGrace: 5 minutes
Ping Time:             2 hours
Ping Timeout:          20 seconds
```

**Scaling:** 1 pod ≈ 8,000 concurrent driver connections → 100K drivers requires ~13 pods.

---

### Service 2: Dispatch Matching Service (`cmd/dispatch/main.go`)

**Purpose:** Consume `order.created` events, run the three-phase matching algorithm, and atomically assign a driver to each order.

**Startup Sequence:**
```
1. Parse env: DATABASE_URL, REDIS_CLUSTER_NODES, KAFKA_BROKERS,
              ALGORITHM_STRATEGY, TRITON_SERVER_ADDR, REDIS_IP_MAP
2. Initialize pgxpool (MaxConns: 10, MinConns: 2, IdleTimeout: 15m)
3. Ping PostgreSQL — fatal if unreachable
4. Initialize Redis Cluster client (identical tuning to ingestion)
5. Ping Redis Cluster — fatal if unreachable
6. Initialize ContractionHierarchiesService
     Pre-seed nodes 1001 and 9999 with bidirectional edge (10s ETA)
7. Attempt Triton gRPC connection (TRITON_SERVER_ADDR)
     On failure: log WARNING, continue in pure-graph mode
8. Wire: TritonClient + RoutingSvc → ETACorrectorUseCase
9. Wire: RedisCluster → SpatialScanner
10. Start OrderCreatedConsumer (Kafka group: dispatch-matching-group)
11. Launch StartExecutionPipeline goroutine
12. Await SIGTERM/SIGINT → cancel context → graceful consumer close
```

**Algorithm Selection (ALGORITHM_STRATEGY env var):**

| Value | Use Case | Complexity |
|---|---|---|
| `GREEDY` | Launch / < 500 concurrent orders | O(N log N) |
| `HUNGARIAN` | 500–5,000 concurrent orders | O(N³) |
| `AUCTION` | 5,000+ concurrent orders | O(N log N) amortized |

---

### Service 3: Simulator (`cmd/simulator/main.go`)

**Purpose:** End-to-end smoke test client. Sends synthetic driver telemetry and order events to validate the full pipeline without a real mobile app.

**Workflow:**
```
Phase 1 → gRPC stream driver locations → triggers Redis ZSET write
Phase 2 → Produce order.created to Kafka → triggers dispatch matching
Phase 3 → Query PostgreSQL → validate order has assigned_driver_id
```

---

## 6. Data Flow & Event Pipeline

### Flow A: Driver Location Update

```
Driver App
  │  gRPC ClientStreamPositions (streaming RPC)
  ▼
LocationIngestionHandler.StreamPositions()
  │  IngestionRequest{driver_id, city_prefix, lat, lng, bearing, speed, timestamp}
  ▼
TelemetryUseCase.ProcessLocationUpdate()
  │
  ├─► H3 cell computation (uber/h3-go, resolution 8)
  │     h3Cell = h3.FromGeo({lat, lng}, 8)
  │
  ├─► RedisRepository.UpsertDriverLocation()
  │     Key:   driver:{city_prefix}:{driver_id}:profile
  │     ZADD   driver:location:{city_prefix}:{h3Cell}  score=unix_ts  member=driver_id
  │     (sorted set; stale threshold = 30 seconds)
  │
  └─► KafkaProducer.PublishLocationUpdate()
        Topic:   driver.location.updated
        Key:     city_prefix  (ensures city-level partitioning)
        Payload: DriverLocation JSON
```

### Flow B: Order Dispatch (Critical Path — SLA < 500 ms)

```
Order API (external)
  │  Produce to Kafka
  ▼
Kafka topic: order.created  (partitioned by city_prefix)
  │
  ▼
OrderCreatedConsumer.StartExecutionPipeline()
  │
  ├─► Batch accumulation: 200–400 ms window OR 150 orders threshold
  │
  ▼
For each order in batch:
  │
  ├─► Phase 1 — Spatial Reduction (SpatialScanner)
  │     h3.KRing(pickupH3Cell, 1) → 7 cells (target + 6 neighbors ≈ 5 km radius)
  │     SMEMBERS driver:location:{city}:{cell} for each of 7 cells
  │     Filter: state=ONLINE_AVAILABLE, is_verified=true, stale < 30s
  │     Result: O(1) candidate set (typically 5–50 drivers)
  │
  ├─► Phase 2 — ETA Estimation (ETACorrectorUseCase)
  │     For each candidate driver:
  │       baseETA = ContractionHierarchies.ComputeShortestPathETA(
  │                     driver.OSMNodeID, order.PickupOSMNodeID)
  │       [optional] correctedETA = Triton.ModelInfer(XGBoost,
  │                     features=[baseETA, hour, weekday, demandDensity, supplyDensity])
  │       if Triton latency > 40ms OR error: fallback to baseETA (circuit breaker)
  │
  ├─► Phase 3 — Batch Optimization (Matcher)
  │     GREEDY:    score each candidate; pick minimum cost
  │     HUNGARIAN: build cost matrix; solve bipartite assignment
  │
  │     Cost Function (weighted objective):
  │       cost = (0.45 × ETA_seconds)
  │            + (0.25 × (1 - acceptance_rate))
  │            + (0.15 × cancellation_probability)
  │            + (0.10 × surge_zone_penalty)      // 0.0 if in zone, 1.0 if outside
  │            + (0.05 × (1 / (idle_seconds + 1)))
  │
  ▼
commitAssignmentTransaction() — atomic PostgreSQL write
  │   BEGIN
  │   UPDATE orders SET status='ASSIGNED', assigned_driver_id=$1, assigned_at=NOW()
  │       WHERE id=$2 AND status='CREATED'  ← optimistic lock
  │   UPDATE drivers SET current_state='ONLINE_EN_ROUTE' WHERE id=$1
  │   INSERT INTO dispatch_match_logs (...) VALUES (...)
  │   COMMIT
  │
  └─► Produce to Kafka: order.assigned
        Payload: {order_id, driver_id, eta_seconds, algorithm_used, score}
```

### Flow C: Surge Pricing (Async — 30-second cadence)

```
Kafka: order.created ──────► DemandAggregator
                               ZADD surge:demand:{city}:{h3Cell}  score=expiry  member=order_id
                               30-second sliding window via ZREMRANGEBYSCORE

Kafka: driver.state.changed ─► SupplyAggregator
                               ZADD surge:supply:{city}:{h3Cell}  score=expiry  member=driver_id

Every 30 seconds:
SurgeCalculatorEngine.evaluateCitySurgeGrid(city, activeCells)
  │  demandRate = ZCARD surge:demand:{city}:{cell}
  │  supplyCount = ZCARD surge:supply:{city}:{cell}
  │
  │  multiplier = max(1.0, demandRate / (supplyCount × 0.7))
  │  multiplier = min(multiplier, 4.5)   ← hard safety cap
  │  multiplier = round(multiplier, 2)
  │
  └─► Produce to Kafka: surge.zone.updated
        Payload: {city, h3Cell, multiplier, computed_at}

Kafka: surge.zone.updated ───► OrderPricingService
                               in-memory surge matrix map[city][h3Cell]float64
                               consulted at order creation for base_fare_paise
```

---

## 7. Database Design

### PostgreSQL 15 + PostGIS 3.3

#### Table: `regional_cities`

```sql
CREATE TABLE regional_cities (
    city_prefix  VARCHAR(10) PRIMARY KEY,        -- 'KOL', 'DEL', 'MUM'
    city_name    VARCHAR(100) NOT NULL,
    timezone     VARCHAR(50)  DEFAULT 'Asia/Kolkata' NOT NULL,
    is_active    BOOLEAN      DEFAULT true NOT NULL,
    geofence     GEOGRAPHY(MultiPolygon, 4326),  -- PostGIS city boundary
    created_at   TIMESTAMPTZ  DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_cities_geofence ON regional_cities USING GIST(geofence);
```

#### Table: `drivers`

```sql
CREATE TABLE drivers (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_prefix          VARCHAR(10) REFERENCES regional_cities NOT NULL,
    name                 VARCHAR(100) NOT NULL,
    phone                VARCHAR(15)  UNIQUE NOT NULL,
    dl_number            VARCHAR(50)  UNIQUE NOT NULL,
    current_state        driver_state_enum DEFAULT 'OFFLINE' NOT NULL,
    is_verified          BOOLEAN DEFAULT false NOT NULL,
    acceptance_rate      NUMERIC(4,3) DEFAULT 1.000 NOT NULL,  -- used in cost function
    cancellation_rate    NUMERIC(4,3) DEFAULT 0.000 NOT NULL,  -- used in cost function
    last_known_location  GEOGRAPHY(Point, 4326),               -- fallback PostGIS point
    updated_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Compound index for matching query: city + state + verified
CREATE INDEX idx_drivers_search ON drivers(city_prefix, current_state, is_verified);
CREATE INDEX idx_drivers_location ON drivers USING GIST(last_known_location);
```

**Driver State Machine:**
```
OFFLINE ──────────────► ONLINE_AVAILABLE
                              │
                  ┌───────────┴──────────┐
                  ▼                      ▼
          ONLINE_EN_ROUTE          BUSY_BATCH
                  │
                  ▼
        ONLINE_DELIVERING
                  │
                  ▼
               OFFLINE
```

#### Table: `orders`

```sql
CREATE TABLE orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_prefix       VARCHAR(10) REFERENCES regional_cities NOT NULL,
    customer_id       UUID NOT NULL,
    status            order_status_enum DEFAULT 'CREATED' NOT NULL,
    pickup_location   GEOGRAPHY(Point, 4326) NOT NULL,
    dropoff_location  GEOGRAPHY(Point, 4326) NOT NULL,
    pickup_h3_cell    VARCHAR(15) NOT NULL,           -- H3 resolution 8 cell string
    assigned_driver_id UUID REFERENCES drivers(id),
    surge_multiplier  NUMERIC(3,2) DEFAULT 1.00 NOT NULL,
    base_fare_paise   INT NOT NULL,                   -- integer currency (Paise) = no float errors
    assigned_at       TIMESTAMPTZ,
    picked_up_at      TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Partial index: only CREATED orders in the matching hot path
CREATE INDEX idx_orders_matching_state ON orders(city_prefix, status) WHERE status = 'CREATED';
CREATE INDEX idx_orders_pickup ON orders USING GIST(pickup_location);
```

**Order State Machine (enforced by DB trigger):**
```
CREATED ──► ASSIGNED ──► EN_ROUTE_TO_PICKUP ──► DELIVERING ──► COMPLETED (terminal)
   │            │                  │                               
   └────────────┴──────────────────┴──────────────────────────► CANCELLED (terminal)

Terminal states (COMPLETED, CANCELLED) cannot be mutated — trigger raises exception.
```

**DB-Level State Machine Trigger:**
```sql
CREATE OR REPLACE FUNCTION verify_order_state_transition() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: Cannot mutate a terminal trip state.';
    END IF;
    IF OLD.status = 'CREATED' AND NEW.status NOT IN ('ASSIGNED', 'CANCELLED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: New orders must move to ASSIGNED or CANCELLED.';
    END IF;
    IF OLD.status = 'DELIVERING' AND NEW.status NOT IN ('COMPLETED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: Orders in flight can only transition to COMPLETED.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_order_state_machine
BEFORE UPDATE ON orders FOR EACH ROW
EXECUTE FUNCTION verify_order_state_transition();
```

#### Table: `dispatch_match_logs` (Audit Ledger)

```sql
CREATE TABLE dispatch_match_logs (
    id                       BIGSERIAL PRIMARY KEY,
    order_id                 UUID REFERENCES orders NOT NULL,
    batch_window_started_at  TIMESTAMPTZ NOT NULL,
    batch_window_ended_at    TIMESTAMPTZ NOT NULL,
    algorithm_used           VARCHAR(50) NOT NULL,   -- 'GREEDY', 'HUNGARIAN', 'AUCTION'
    total_candidates_evaluated INT NOT NULL,
    chosen_driver_id         UUID REFERENCES drivers NOT NULL,
    computed_eta_seconds     INT NOT NULL,
    assignment_score         NUMERIC(10,4) NOT NULL, -- composite objective score
    created_at               TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_match_logs_order ON dispatch_match_logs(order_id);
```

**Purpose:** Immutable audit trail. Enables:
- SLA dispute resolution (prove < 500 ms dispatch was achieved)
- Algorithm A/B testing comparison
- ML training data for ETA model improvement

### Connection Pool Tuning

| Service | MaxConns | MinConns | IdleTimeout |
|---|---|---|---|
| Location Ingestion | 50 | 10 | 15 minutes |
| Dispatch Matching | 10 | 2 | 15 minutes |

---

## 8. Redis Spatial Index Design

### Topology: 6-Shard Cluster

```
Primary 0  (slots 0 – 5460)    ←→  Replica 3
Primary 1  (slots 5461 – 10922) ←→  Replica 4
Primary 2  (slots 10923 – 16383)←→  Replica 5
```

### Key Schema

| Key Pattern | Type | TTL / Eviction | Description |
|---|---|---|---|
| `driver:location:{city}:{h3Cell}` | ZSET | Score = unix_ts (30s stale window) | Driver positions per H3 cell |
| `driver:{city}:{driver_id}:profile` | HASH | — | Driver metadata (state, acceptance_rate) |
| `surge:demand:{city}:{h3Cell}` | ZSET | Score = expiry_ts | Active orders per cell (30s window) |
| `surge:supply:{city}:{h3Cell}` | ZSET | Score = expiry_ts | Available drivers per cell (30s window) |

### H3 Resolution 8

- Cell edge length: ~0.46 km
- Cell area: ~0.74 km²
- K-ring radius 1 (target + 6 neighbors): covers ~5 km radius pickup zone
- Single Redis SMEMBERS call per cell = O(1) candidate retrieval

### Stale Driver Pruning

```
ZREMRANGEBYSCORE driver:location:{city}:{cell}  0  (now - 30)
SMEMBERS         driver:location:{city}:{cell}
```
Drivers not sending telemetry for > 30 seconds are automatically excluded from matching.

### Client Configuration

```go
redis.ClusterOptions{
    Addrs:          nodeList,
    ReadOnly:       false,
    RouteByLatency: true,
    DialTimeout:    2 * time.Second,
    ReadTimeout:    500 * time.Millisecond,
    WriteTimeout:   500 * time.Millisecond,
}
```

---

## 9. Kafka Topic Topology

### Cluster Configuration

```
Mode:         KRaft (no ZooKeeper)
Image:        confluentinc/cp-kafka:7.5.0
Replication:  1 (dev) / 3 (production)
```

### Topic Reference

| Topic | Partitions | Key Strategy | Producers | Consumers |
|---|---|---|---|---|
| `order.created` | 12 | city_prefix | Order API | Dispatch Matching, Demand Aggregator |
| `order.assigned` | 12 | order_id | Dispatch Matching | Driver App, Order State Machine |
| `driver.location.updated` | 24 | city_prefix | Location Ingestion | Dispatch Matching, Surge Pricing |
| `driver.state.changed` | 12 | city_prefix | Driver State Service | Supply Aggregator |
| `surge.zone.updated` | 12 | city_prefix | Surge Calculator | Order Pricing Service, Driver App |

### Consumer Groups

| Group ID | Topics Consumed | Service |
|---|---|---|
| `dispatch-matching-group` | `order.created` | Dispatch Matching Service |
| `demand-aggregator-group` | `order.created` | Surge Demand Aggregator |
| `supply-aggregator-group` | `driver.state.changed` | Surge Supply Aggregator |
| `pricing-sync-group` | `surge.zone.updated` | Order Pricing Service |

### Partition Key Rationale

- **city_prefix** as partition key: all events for a city land on the same partition, ensuring ordered processing within a city and enabling city-level consumer scaling.
- **order_id** for `order.assigned`: ensures downstream consumers (driver app, state machine) process a single order's events in order.

---

## 10. The Three-Phase Matching Engine

### Phase 1 — Spatial Reduction (`internal/dispatch/repository/`)

**Goal:** Reduce the search space from 100K drivers to ~50 candidates in O(1).

```
Input:  order.pickup_h3_cell (H3 resolution 8 string)

Step 1: h3.KRing(pickupCell, k=1) → 7 cells
Step 2: For each cell:
          ZREMRANGEBYSCORE driver:location:{city}:{cell} 0 (now-30)  ← prune stale
          SMEMBERS driver:location:{city}:{cell}                      ← get candidates

Step 3: Fetch driver profiles (acceptance_rate, cancellation_rate, current_state)
Step 4: Filter: current_state = ONLINE_AVAILABLE AND is_verified = true

Output: []CandidateDriver{DriverID, OSMNodeID, DistanceMeters, AcceptanceRate,
                           CancellationProbability, IsInsideSurgeZone, IdleSeconds}
```

### Phase 2 — ETA Estimation (`internal/routing/graph/`, `internal/intelligence/`)

**Goal:** Compute realistic travel time from each candidate driver to pickup point.

#### Contraction Hierarchies Algorithm

```
Preprocessing (one-time per city road graph):
  1. Rank all nodes by "importance" (edge difference + degree)
  2. Contract lower-importance nodes: add shortcut edges
  3. Build upward/downward search graphs

Query (per driver-order pair, < 10ms):
  1. Forward Dijkstra from driver OSM node (upward graph)
  2. Backward Dijkstra from pickup OSM node (downward graph)
  3. Merge at highest-importance meeting node
  4. Return total edge weight (travel time in seconds)
```

#### ML ETA Correction (Triton XGBoost)

```
Model:   xgboost_spatial_corrector (Triton model repository)
Input:   [baseETA_seconds, hour_of_day, day_of_week,
          demand_density_h3cell, supply_density_h3cell]
Output:  corrected_eta_multiplier (float32)
Timeout: 40ms circuit breaker — fallback to baseETA on breach
```

**Circuit Breaker Behavior:**
```go
correctedETA, err := tritonClient.ModelInfer(ctx, features)
if err != nil || latency > 40ms {
    // Fallback: use Contraction Hierarchies ETA directly
    correctedETA = baseETA
}
```

### Phase 3 — Batch Optimization (`internal/dispatch/matcher/`)

**Goal:** Optimally assign the highest-scoring driver to each order in the batch.

#### Cost Function (lower = better)

```
cost = (0.45 × ETA_seconds)
     + (0.25 × (1.0 - acceptance_rate))
     + (0.15 × cancellation_probability)
     + (0.10 × surge_zone_penalty)        // 0.0=inside zone, 1.0=outside zone
     + (0.05 × (1.0 / (idle_seconds + 1)))

Example (driver-closest-high-ar):
  ETA=1.0s, AR=0.90, CP=0.01, surge=inside, idle=10s
  cost = (0.45×1.0) + (0.25×0.10) + (0.15×0.01) + (0.10×0.0) + (0.05×(1/11))
       = 0.450 + 0.025 + 0.0015 + 0.0 + 0.00454
       = 0.481
```

#### Algorithm Detail

**GREEDY** (`EvaluateGreedyMatch`):
```
For each order:
  1. Score all candidate drivers using cost function
  2. Select driver with minimum cost
  3. Mark driver as unavailable for remaining orders in batch
Time: O(N × D) where N=orders, D=drivers per order
```

**HUNGARIAN** (`EvaluateHungarianOptimization`):
```
1. Build N×D cost matrix
2. Solve bipartite minimum-cost perfect matching
3. Guarantees globally optimal assignment across entire batch
Time: O(N³) — viable for 500–5,000 concurrent orders
```

**Circuit Breaker for Routing Failure:**
```go
// If CH routing fails, fallback ETA = DistanceMeters / 11.1 (4 km/h walking speed)
fallbackETA = candidate.DistanceMeters / 11.1
```

### Batch Window Configuration

```
Trigger condition 1: timer expires (200ms minimum, 400ms maximum)
Trigger condition 2: 150 orders accumulated (whichever comes first)

Rationale: Sub-400ms batch window keeps total dispatch latency well under 500ms SLA,
while batching amortizes the O(N³) Hungarian overhead across multiple orders.
```

### Atomic Assignment Transaction

```sql
BEGIN;
  -- Optimistic lock: only assign if still CREATED
  UPDATE orders
     SET status = 'ASSIGNED',
         assigned_driver_id = $driver_id,
         assigned_at = NOW()
   WHERE id = $order_id
     AND status = 'CREATED';

  -- Transition driver state
  UPDATE drivers
     SET current_state = 'ONLINE_EN_ROUTE'
   WHERE id = $driver_id;

  -- Write immutable audit record
  INSERT INTO dispatch_match_logs
    (order_id, batch_window_started_at, batch_window_ended_at,
     algorithm_used, total_candidates_evaluated,
     chosen_driver_id, computed_eta_seconds, assignment_score)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
COMMIT;
```

---

## 11. Surge Pricing Pipeline

### Design Principle

Surge pricing is implemented as a **zero-cost extension** of the dispatch event stream. No additional infrastructure is required — all data flows through topics that already exist.

### Formula

```
effective_supply = max(supply_count, 0.5)   ← prevent division by zero
raw_multiplier   = demand_rate / (effective_supply × 0.7)
multiplier       = max(1.0, raw_multiplier)
multiplier       = min(multiplier, 4.5)     ← hard safety cap
multiplier       = round(multiplier, 2)

Test cases:
  demand=0,   supply=0  → 1.00  (no demand, floor applies)
  demand=5,   supply=0  → 4.50  (capped at safety ceiling)
  demand=10,  supply=10 → 1.43  (10 / (10 × 0.7) = 1.43)
  demand=2,   supply=10 → 1.00  (0.29 < 1.0 → floor applies)
  demand=100, supply=5  → 4.50  (28.57 → capped)
```

### Component Responsibilities

| Component | Package | Input | Output |
|---|---|---|---|
| `DemandAggregator` | `internal/surge/aggregator` | `order.created` Kafka | Redis ZSET `surge:demand:{city}:{cell}` |
| `SupplyAggregator` | `internal/surge/aggregator` | `driver.state.changed` Kafka | Redis ZSET `surge:supply:{city}:{cell}` |
| `SurgeCalculatorEngine` | `internal/surge/calculator` | Redis ZSETs (every 30s) | `surge.zone.updated` Kafka |
| `OrderPricingService` | `internal/pricing/service` | `surge.zone.updated` Kafka | in-memory `map[city][h3Cell]float64` |

### Surge Data Lifecycle

```
order arrives
    │ ZADD surge:demand:{city}:{cell}  score=(now+30)  member=order_id
    │
    │  [30s expiry: ZREMRANGEBYSCORE removes score < now]
    │
    ▼
driver goes ONLINE_AVAILABLE
    │ ZADD surge:supply:{city}:{cell}  score=(now+30)  member=driver_id
    │
    ▼
SurgeCalculator tick (every 30s)
    │ ZCARD demand → demand_rate
    │ ZCARD supply → supply_count
    │ compute multiplier
    │ publish surge.zone.updated
    │
    ▼
OrderPricingService
    │ update in-memory surge matrix
    │ new orders read current multiplier at creation time
```

---

## 12. ML Intelligence Layer (Triton)

### Architecture

```
Triton Inference Server
  └── Model: xgboost_spatial_corrector
        └── Version 1
              └── config.pbtxt (XGBoost FIL backend)

Input tensor:  float32[1][5]
  features[0] = base_eta_seconds
  features[1] = hour_of_day (0-23)
  features[2] = day_of_week (0-6)
  features[3] = demand_density (orders/km² in H3 cell)
  features[4] = supply_density (drivers/km² in H3 cell)

Output tensor: float32[1][1]
  output[0] = corrected_eta_multiplier
```

### gRPC Integration (`internal/intelligence/client/`)

```
TritonClient.ModelInfer(ctx, modelName, version, inputTensors)
  → POST /v2/models/{model}/infer via gRPC
  → Decode raw bytes as float32
  → Return corrected ETA = baseETA × multiplier
```

### Fallback Strategy

```
if tritonAddr == "" OR connection fails at startup:
    log.WARNING "Running in pure-graph mode"
    etaCorrector = passthrough (returns baseETA unchanged)

if Triton call fails at inference time OR latency > 40ms:
    return baseETA from Contraction Hierarchies
```

### Model Repository Structure

```
model_repository/
└── xgboost_spatial_corrector/
    └── 1/
        └── config.pbtxt    # model name, backend: "fil", input/output shapes
```

---

## 13. gRPC API Contracts

### Service 1: LocationIngestionService

**Proto source:** `api/proto/telemetry/v1/telemetry.proto`  
**Generated Go:** `pkg/api/telemetry/v1/`

```protobuf
service LocationIngestionService {
  rpc ClientStreamPositions(stream IngestionRequest) returns (IngestionResponse);
}

message IngestionRequest {
  string driver_id     = 1;
  string city_prefix   = 2;
  double latitude      = 3;
  double longitude     = 4;
  float  bearing       = 5;  // degrees 0–360
  float  speed_kms     = 6;  // km/h
  int64  timestamp_utc = 7;  // Unix timestamp
}

message IngestionResponse {
  bool  success     = 1;
  int64 recorded_at = 2;  // Unix timestamp of server receipt
}
```

**Connection:** `grpc.NewServer()` on `:50051` with keepalive params for 8K+ concurrent streams.

---

### Service 2: GRPCInferenceService (Triton)

**Proto source:** `api/proto/triton/triton.proto`  
**Generated Go:** `pkg/api/triton/`

```protobuf
service GRPCInferenceService {
  rpc ModelInfer(ModelInferRequest) returns (ModelInferResponse);
}

message ModelInferRequest {
  string model_name    = 1;
  string model_version = 2;
  repeated InferInputTensor inputs = 3;
}

message InferInputTensor {
  string name       = 1;  // "input"
  string datatype   = 2;  // "FP32"
  repeated int64 shape = 3;  // [1, 5]
  bytes  contents   = 4;  // raw float32 bytes
}

// Response contains raw binary output tensors
```

---

## 14. Configuration & Environment Variables

### Complete Reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | `postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable` | Yes | PostgreSQL DSN |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` | Yes | Comma-separated Redis node addresses |
| `KAFKA_BROKERS` | `localhost:19092` | Yes | Comma-separated Kafka broker endpoints |
| `GRPC_PORT` | `50051` | No | Location Ingestion gRPC listen port |
| `ALGORITHM_STRATEGY` | `GREEDY` | No | Matching algorithm: `GREEDY` \| `HUNGARIAN` \| `AUCTION` |
| `TRITON_SERVER_ADDR` | `127.0.0.1:8001` | No | Triton Inference Server gRPC endpoint (empty = disable ML) |
| `REDIS_IP_MAP` | `` | No | Pod IP mapping for local port-forwarding: `10.0.0.1:6379=localhost:6379,...` |

### Environment File (`.env.local` — do not commit)

```bash
export DATABASE_URL="postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
export REDIS_CLUSTER_NODES="127.0.0.1:6379,127.0.0.1:6380,127.0.0.1:6381"
export KAFKA_BROKERS="localhost:19092"
export ALGORITHM_STRATEGY="GREEDY"
export TRITON_SERVER_ADDR=""
export GRPC_PORT="50051"
```

---

## 15. Local Development Setup

### Prerequisites

```
- Go 1.26.3+
- kubectl (connected to a local cluster: minikube, k3d, Docker Desktop)
- PowerShell (Windows) or Bash (Linux/macOS)
```

### Step 1: Start Infrastructure

```bash
# Bash
./deploy/local/start-local-infra.sh

# PowerShell
kubectl apply -f deploy/local/local-dev-topology.yaml
kubectl rollout status statefulset/postgres
kubectl rollout status statefulset/kafka
kubectl rollout status statefulset/redis-cluster
```

This script:
1. Applies the K8s manifest (Postgres, Kafka, Redis)
2. Waits for all StatefulSets and Jobs to be ready
3. Establishes port-forwards (5432, 19092, 6379–6381)
4. Exports all required environment variables

### Step 2: Build Services

```bash
# Build all services
go build -o bin/dispatch.exe  ./cmd/dispatch/
go build -o bin/ingestion.exe ./cmd/ingestion/
go build -o bin/simulator.exe ./cmd/simulator/
```

### Step 3: Run Services

```bash
# Terminal 1: Location Ingestion Service
bin\ingestion.exe

# Terminal 2: Dispatch Matching Service
bin\dispatch.exe

# Terminal 3: Simulator (smoke test)
bin\simulator.exe
```

### Step 4: Run E2E Test Suite (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\run_e2e_test.ps1
```

The PowerShell script:
- Dynamically queries Redis pod IPs via kubectl
- Builds `REDIS_IP_MAP` for local port-forwarding
- Seeds PostgreSQL with test driver and city data
- Runs the simulator client
- Validates `orders.assigned_driver_id` is populated in PostgreSQL

### Step 5: Tear Down

```bash
./deploy/local/teardown-local-infra.sh
# or
kubectl delete -f deploy/local/local-dev-topology.yaml
```

---

## 16. Testing Strategy

### Test Coverage Map

| Layer | Test File | Type | Build Tag |
|---|---|---|---|
| Greedy Matcher | `internal/dispatch/matcher/greedy_test.go` | Unit | none |
| Hungarian Matcher | `internal/dispatch/matcher/` | Unit | none |
| Spatial Scanner | `internal/dispatch/repository/spatial_scanner_test.go` | Unit | none |
| Order Consumer | `internal/dispatch/consumer/order_consumer_test.go` | Compile check | none |
| Contraction Hierarchies | `internal/routing/graph/contraction_hierarchies_test.go` | Unit | none |
| Surge Calculator | `internal/surge/calculator/surge_calculator_test.go` | Unit + Integration | none |
| Supply Aggregator | `internal/surge/aggregator/supply_aggregator_test.go` | Unit | none |
| Demand Aggregator | `internal/surge/aggregator/demand_aggregator_test.go` | Unit | none |
| Telemetry Use Case | `internal/telemetry/usecase/telemetry_usecase_test.go` | Unit | none |
| Redis Repository | `internal/telemetry/repository/redis_repo_test.go` | Unit | none |
| Order Pricing | `internal/pricing/service/order_pricing_service_test.go` | Unit | none |
| E2E Matching | `internal/test/e2e_matching_test.go` | E2E (mock gRPC) | `integration` |
| E2E Full Pipeline | `test/integration/dispatch_e2e_test.go` | E2E (live infra) | `integration` |
| gRPC Handler | `internal/telemetry/delivery/grpc/handler_test.go` | Unit | none |

### Running Tests

```bash
# Unit tests only (no infrastructure needed)
go test ./internal/... -v

# Integration tests (requires live Kubernetes infra)
go test ./internal/... -v -tags=integration
go test ./test/integration/... -v -tags=integration

# Single package
go test ./internal/dispatch/matcher/... -v -run TestEvaluateGreedyMatch

# With coverage
go test ./internal/... -coverprofile=coverage.out
go tool cover -html=coverage.out
```

### Key Test Scenarios

**Greedy Matcher (`greedy_test.go`):**
- `TestEvaluateGreedyMatch_Success` — Validates cost function weights and optimal driver selection
- `TestEvaluateGreedyMatch_Starvation` — Validates error on empty candidate set
- `TestEvaluateGreedyMatch_CircuitBreakerFallback` — Validates fallback ETA when routing fails

**Surge Calculator (`surge_calculator_test.go`):**
- `TestSurgeCalculatorEngine_FormulaMath` — Validates formula for 5 demand/supply combinations including cap enforcement
- `TestEvaluateCitySurgeGrid_Integration` — Seeds Redis ZSETs and validates end-to-end surge computation

---

## 17. Scalability Model

### Driver Scale vs. Infrastructure

| Active Drivers | Ingestion Pods | Redis Shards | Kafka Partitions | DB Connections |
|---|---|---|---|---|
| 10,000 | 2 | 6 | 12 | 20–100 |
| 50,000 | 7 | 6–12 | 24 | 100–500 |
| 100,000 | 13 | 12 | 24–48 | 200–1,000 |

**Scaling Formula:**  
`ingestion_pods = ceil(active_drivers / 8,000)`

### Horizontal Scaling Triggers

| Component | Scaling Signal | Scaling Unit |
|---|---|---|
| Location Ingestion | CPU > 70% OR active streams > 7,000 per pod | +1 pod |
| Dispatch Matching | Kafka consumer lag > 1,000 messages | +1 pod |
| Surge Aggregators | Kafka consumer lag > 500 messages | +1 pod |
| Redis Cluster | Memory > 75% per shard | +2 shards (reshard) |

### Throughput Estimates

| Metric | Value |
|---|---|
| Location updates/sec (100K drivers @ 1/4s) | 25,000 msg/s |
| Peak orders/sec (10+ cities) | 500–2,000 orders/s |
| Redis ZADD throughput per shard | ~100,000 ops/s |
| Kafka throughput (driver.location.updated) | 25,000 msg/s on 24 partitions |

### H3 Spatial Partitioning for Multi-City

- Each city operates on independent H3 cells
- City prefix is part of every Redis key and Kafka partition key
- Adding a new city = insert row into `regional_cities` + configure geofence — zero code change

---

## 18. Resilience & Failure Modes

### Failure Scenarios & Mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| **Triton Inference timeout (> 40ms)** | Per-call latency check | Circuit breaker: fallback to CH routing ETA |
| **Triton server unavailable at startup** | Connection error | Log WARNING, continue in pure-graph mode |
| **Redis Cluster shard failure** | `Ping()` error / MOVED response | go-redis automatic slot redirection to replica |
| **Kafka broker down** | Producer/consumer error | kafka-go retry with exponential backoff |
| **PostgreSQL connection pool exhausted** | pgxpool queue timeout | MaxConns limit; shed excess with deadline context |
| **Stale driver in spatial index** | ZREMRANGEBYSCORE prune (30s) | Stale drivers auto-excluded before candidate scoring |
| **Order double-assignment race** | DB trigger + `WHERE status='CREATED'` | Optimistic lock in UPDATE; second assignment silently skipped |
| **Terminal state mutation** | DB trigger raise exception | `verify_order_state_transition()` raises on COMPLETED/CANCELLED |
| **No candidates found (starvation)** | `EvaluateGreedyMatch` returns error | Order remains `CREATED`; re-queued on next Kafka consumer poll |
| **CH routing graph disconnected node** | `ComputeShortestPathETA` error | Fallback ETA = `DistanceMeters / 11.1` (walking speed) |

### Graceful Shutdown Protocol

**Location Ingestion Service:**
```
SIGTERM received
→ grpcServer.GracefulStop() (drains active streams)
→ 15-second hard deadline: GracefulStop → Force Stop
→ Redis client Close()
→ Kafka producer Close()
→ pgxpool Close()
→ context Cancel()
→ Exit 0
```

**Dispatch Matching Service:**
```
SIGTERM received
→ context Cancel() (stops StartExecutionPipeline goroutine)
→ OrderCreatedConsumer.Close() (commits Kafka offsets)
→ Redis client Close()
→ pgxpool Close()
→ Exit 0
```

---

## 19. Production Hardening Checklist

### Security

- [ ] Replace `credentials.insecure.NewCredentials()` with mTLS on all gRPC connections
- [ ] Store `DATABASE_URL`, Redis credentials in Kubernetes Secrets (not env vars)
- [ ] Enable Kafka TLS (SASL/SCRAM-SHA-512) — change listener from `PLAINTEXT` to `SSL`
- [ ] Add Redis `requirepass` authentication to all cluster nodes
- [ ] Apply Kubernetes Network Policies to isolate service namespaces
- [ ] Enable PostgreSQL SSL mode (`sslmode=require`)
- [ ] Add API Gateway with JWT authentication upstream of Location Ingestion Service

### Observability

- [ ] Instrument all services with OpenTelemetry (traces, metrics, logs)
- [ ] Add Prometheus metrics: `dispatch_latency_histogram`, `matching_batch_size`, `surge_multiplier_gauge`
- [ ] Ship structured logs (JSON) to centralized log aggregator
- [ ] Alert on: consumer lag > 1,000 messages, dispatch P99 > 450ms, Redis memory > 75%
- [ ] Add `dispatch_match_logs` dashboards for SLA monitoring

### Production Kafka

- [ ] Increase replication factor to 3
- [ ] Set `min.insync.replicas=2`
- [ ] Enable topic compaction on `driver.state.changed`
- [ ] Configure retention: `driver.location.updated` = 1 hour, `dispatch.match` = 7 days

### Production PostgreSQL

- [ ] Enable connection pooler (PgBouncer) in front of PostgreSQL
- [ ] Add read replicas for `dispatch_match_logs` analytics queries
- [ ] Schedule VACUUM ANALYZE on `orders` and `drivers` tables
- [ ] Implement TimescaleDB or archival for `dispatch_match_logs` beyond 90 days

### CI/CD (Missing — add these)

- [ ] GitHub Actions workflow: `go test ./...` on every PR
- [ ] Docker image builds for `dispatch`, `ingestion` services
- [ ] Helm charts for Kubernetes deployments (replace raw YAML manifests)
- [ ] KEDA ScaledObject for autoscaling `ingestion` pods on gRPC stream count
- [ ] Canary deployment for `ALGORITHM_STRATEGY` changes

### Road Graph

- [ ] Load real OSM data per city into `ContractionHierarchiesService` at startup
- [ ] Implement periodic road graph refresh (weekly OSM data updates)
- [ ] Store CH preprocessed graph in persistent volume (skip recomputation on restart)

---

## 20. Glossary

| Term | Definition |
|---|---|
| **CH** | Contraction Hierarchies — a graph preprocessing algorithm enabling sub-10ms shortest-path queries on road networks |
| **H3** | Uber's hexagonal hierarchical spatial index — divides Earth into hexagonal cells at configurable resolutions |
| **H3 Resolution 8** | ~0.74 km² cells; the spatial granularity used for driver indexing and surge computation |
| **K-Ring** | H3 operation returning a target cell plus all cells within k steps; k=1 produces 7 cells covering ~5 km radius |
| **ZADD** | Redis sorted set add command — stores a member with a floating-point score (used for Unix timestamps here) |
| **ZREMRANGEBYSCORE** | Redis sorted set range removal by score — used to prune stale drivers (score < now-30s) |
| **KRaft** | Kafka Raft — Kafka's built-in consensus mode that eliminates the ZooKeeper dependency |
| **Dispatch Batch Window** | Time window (200–400ms) during which arriving orders are accumulated before running the matching algorithm |
| **Hungarian Algorithm** | Polynomial-time O(N³) algorithm for solving the assignment problem (bipartite minimum-cost matching) |
| **Triton** | NVIDIA Triton Inference Server — serves ML models (XGBoost, TensorRT, ONNX) via gRPC |
| **ETACorrectorUseCase** | Component that wraps the CH routing service and optionally applies Triton ML correction |
| **SpatialScanner** | Component that queries Redis H3 ZSETs to retrieve candidate drivers for an order |
| **pgxpool** | Go PostgreSQL connection pool (`github.com/jackc/pgx/v5/pgxpool`) |
| **Paise** | Indian currency sub-unit (1/100 Rupee); used for integer-safe monetary storage |
| **Surge Multiplier** | Demand/supply ratio per H3 cell, clamped to [1.0, 4.5], applied to base fare |
| **ONLINE_EN_ROUTE** | Driver state after being assigned an order — navigating to pickup location |
| **BUSY_BATCH** | Driver state reserved for future batch delivery assignments |
| **dispatch_match_logs** | Immutable audit table recording every algorithmic dispatch decision for SLA and ML purposes |

---

*Document compiled: May 2026 · Module: `github.com/platform/driver-delivery` · Go 1.26.3*  
*Maintained by the Platform Engineering team. Update alongside code changes.*
