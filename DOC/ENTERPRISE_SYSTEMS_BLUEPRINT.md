# ENTERPRISE SYSTEMS BLUEPRINT: DRIVER DELIVERY PLATFORM

## Real-Time Dispatch Matching Engine & Surge Pricing Stream Architecture

**Version 1.1 · Production-Ready Specification · May 2026**

---

## SYSTEM CONFIGURATION PROFILE

| Parameter | Value |
|---|---|
| **Scale Target** | 10K to 100K Concurrent Active Drivers |
| **Latency SLA** | < 500ms Global End-to-End Execution |
| **Regional Bounds** | 10+ High-Density Urban Environments |
| **Architecture** | Pure Event-Driven Stream Architecture |
| **Team Size** | 4–10 Engineers |
| **Module** | `github.com/platform/driver-delivery` |
| **Language** | Go 1.26.3 |

---

## TABLE OF CONTENTS

1. [High-Velocity Telemetry Ingestion Pipeline](#section-1-high-velocity-telemetry-ingestion-pipeline)
2. [Spatial Retrieval & Metadata Hydration](#section-2-spatial-retrieval--metadata-hydration)
3. [Time-Windowed Batch Matching & Transaction Fences](#section-3-time-windowed-batch-matching--transaction-fences)
4. [Topological Graph Routing & Contextual Inference](#section-4-topological-graph-routing--contextual-inference)
5. [Triple-Job Revenue Stream Aggregation](#section-5-triple-job-revenue-stream-aggregation)
6. [Local Production Verification Topology](#section-6-local-production-verification-topology)
7. [Production Deployment & Testing Command Patterns](#section-7-production-deployment--testing-command-patterns)

---

## SECTION 1: HIGH-VELOCITY TELEMETRY INGESTION PIPELINE

The telemetry ingestion layer functions as the platform's heartbeat, converting loose geospatial mobile pings into structured, indexable operational states in under 5ms.

### 1.1 The Ingestion Topography

Driver mobile clients maintain long-lived, persistent bidirectional streaming channels over HTTP/2 using **gRPC and Protocol Buffers**. This format provides a 10x reduction in serialization CPU overhead and network bandwidth compared to traditional REST/JSON endpoints. Telemetry packets emit continuously at a fixed **4-second frequency interval**.

```
Driver Mobile App
      │
      │  gRPC ClientStreamPositions (HTTP/2 persistent stream)
      │  IngestionRequest { driver_id, city_prefix, lat, lng,
      │                     bearing, speed_kms, timestamp_utc }
      ▼
LocationIngestionService  (:50051)
      │
      ├──► TelemetryUseCase.ProcessLocationUpdate()
      │         │  H3 radian conversion + cell indexing
      │         ├──► RedisRepository.SetDriverLocation()   (< 2ms)
      │         └──► KafkaProducer.PublishLocationUpdate() (async, non-blocking)
      │
      └──► IngestionResponse { success: true, recorded_at: unix_ts }
```

**Scale:** 1 ingestion pod handles ~8,000 concurrent driver streams.  
**100K drivers** requires `ceil(100,000 / 8,000)` = **13 pods** (KEDA-managed horizontal autoscaling).

---

### 1.2 Mathematical Ingestion Rectification (The Radian Trap)

To avoid silent spatial data corruption, all incoming decimal degree coordinates must be converted to radians before entering the Uber H3 indexing library. The H3 library treats standard decimal degree variables as raw radians if un-rectified, which indexes vehicles into entirely incorrect locations on the global grid.

$$\text{Radians} = \text{Degrees} \times \left( \frac{\pi}{180.0} \right)$$

The Go usecase layer handles this calculation explicitly before computing the target H3 cell index:

```go
// internal/telemetry/usecase/telemetry_usecase.go
latRad := loc.Latitude * (math.Pi / 180.0)
lngRad := loc.Longitude * (math.Pi / 180.0)

centerCoord := h3.GeoCoord{Latitude: latRad, Longitude: lngRad}
resolution8Cell := h3.FromGeo(centerCoord, 8)
```

> **Why this matters:** Passing raw decimal degrees (e.g., `22.5726`) directly to H3's `FromGeo` as if they were radians would place a driver in Kolkata at an entirely different continent on the global hexagonal grid, producing zero candidate matches for every order in that city.

---

### 1.3 High-Scale Redis Shard Scattering Configuration

To achieve true horizontal scaling across the **6-shard Redis Cluster** (3 primary + 3 replica nodes), the data schema avoids city-wide hashtag grouping (`{KOL}`), which creates massive hot spots by forcing an entire city's telemetry onto a single hash slot. Instead, load is distributed uniformly across all cluster shards by grouping keys at the individual driver level:

```
Key Type              Naming Template Scheme                          Target Redis Shard
──────────────────────────────────────────────────────────────────────────────────────────
Driver Status         driver:{city_prefix:driver_id}:status           Scattered via Driver Hash
Driver Cell Tracker   driver:{city_prefix:driver_id}:current_cell     Scattered via Driver Hash
Spatial Index ZSET    drivers:zset:city_prefix:h3_cell_string         Scattered via H3 Cell Hash
```

By keeping the spatial index keys (`drivers:zset:city_prefix:h3_cell_string`) un-bracketed, Redis Cluster hashes the cell token itself. This scatters the geographic segments across all available cluster nodes, while driver profile modifications are safely managed using localized `WATCH` transaction boundaries:

```go
// internal/telemetry/repository/redis_repo.go
statusKey     := fmt.Sprintf("driver:{%s:%s}:status",       loc.CityPrefix, loc.DriverID)
trackerKey    := fmt.Sprintf("driver:{%s:%s}:current_cell", loc.CityPrefix, loc.DriverID)
spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s",          loc.CityPrefix, loc.H3Cell)
```

**Cell migration handling:** When a driver crosses an H3 cell boundary, the repository reads the previous cell from the `trackerKey`, issues a `ZREM` on the old spatial ZSET, then `ZADD`s to the new cell. The pipeline executes atomically in a single cluster round-trip.

```go
// Atomic cell migration pipeline
pipe := r.clusterClient.Pipeline()

if previousCell != "" && previousCell != loc.H3Cell {
    oldZSetKey := fmt.Sprintf("drivers:zset:%s:%s", loc.CityPrefix, previousCell)
    pipe.ZRem(ctx, oldZSetKey, loc.DriverID)
}

pipe.ZAdd(ctx, spatialZSetKey, redis.Z{Score: nowEpoch, Member: loc.DriverID})
pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)
_, err = pipe.Exec(ctx)
```

---

## SECTION 2: SPATIAL RETRIEVAL & METADATA HYDRATION

The `SpatialScanner` intercepts incoming order coordinate rings, isolates active drivers, and hydrates vehicle profiles in a single network operation.

```
[ Step 2.1: Spatial Ring Lookups ]
  Scan Target Hexagon + 6 Neighbors Sequentially
  (Eliminates Cluster CROSSSLOT Execution Failures)
               │
               ▼
[ Step 2.2: Extract Member IDs Pool ]
  Gather Driver ID Strings Within 30s TTL Window
               │
               ▼
[ Step 2.3: Parallel Shard Hydration ]
  Execute Pipeline HMGet on driver:{city:driverID}:profile Keys
               │
               ▼
[ Complete Candidate Pool Sent to Optimization Engine ]
```

---

### 2.1 Sequential Ring Scanning (CROSSSLOT Protection)

To maintain the platform's sub-500ms latency SLA, the scanner queries the target Resolution 8 hexagon (~0.7 km²) along with its 6 immediate neighbors — covering a ~5 km operational search radius.

Because these 7 distinct cell keys reside on different physical shard nodes across the cluster, executing a parallel multi-key command like `MGET` or a multi-key pipeline will cause a `CROSSSLOT Keys in request don't hash to the same slot` runtime exception. The engine avoids this by iterating over the spatial ring coordinates sequentially, pulling active member data in under 2ms:

```go
// internal/dispatch/repository/spatial_scanner.go
spatialRing := h3.KRing(targetCell, 1) // Target cell + 6 immediate neighbors

for _, cell := range spatialRing {
    cellStr := h3.ToString(cell)
    zsetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, cellStr)

    driverIDs, err := s.clusterClient.ZRevRangeByScore(ctx, zsetKey, &redis.ZRangeBy{
        Max: fmt.Sprintf("%d", now),
        Min: fmt.Sprintf("%d", staleThreshold), // Filters out drivers stale for > 30s
    }).Result()
    // ...
}
```

**Stale window math:**
```
staleThreshold = time.Now().Unix() - 30
```
Any driver whose last location write had a ZSET score older than 30 seconds is automatically excluded from the candidate pool — no separate cleanup job required.

---

### 2.2 High-Performance Pipelined Metadata Hydration

Rather than executing separate database reads for every vehicle, the scanner implements a transaction pipeline. This pulls driver metadata — current OpenStreetMap node location, rolling acceptance rates, and historical cancellation probabilities — in a single batch operation using a cluster pipeline:

```go
// internal/dispatch/repository/spatial_scanner.go
pipe   := s.clusterClient.Pipeline()
cmdMap := make(map[string]*redis.SliceCmd)

for _, driverID := range discoveredDriverIDs {
    profileKey := fmt.Sprintf("driver:{%s:%s}:profile", cityPrefix, driverID)
    cmdMap[driverID] = pipe.HMGet(ctx, profileKey,
        "osm_node_id",
        "acceptance_rate",
        "cancellation_probability",
        "is_inside_surge_zone",
        "idle_seconds",
    )
}
_, _ = pipe.Exec(ctx) // Executes concurrently across all cluster shard nodes
```

**Fallback on missing profile:** If a driver's ephemeral profile metadata cache has expired (no HASH entry), the scanner applies safe conservative defaults rather than dropping the candidate:

```go
// Fallback configuration if profile cache has expired
candidates = append(candidates, matcher.CandidateDriver{
    DriverID:                driverID,
    OSMNodeID:               9999,   // General city center vertex fallback
    AcceptanceRate:          0.85,
    CancellationProbability: 0.05,
    IsInsideSurgeZone:       false,
    IdleSeconds:             60.0,
    DistanceMeters:          1500,
})
```

---

## SECTION 3: TIME-WINDOWED BATCH MATCHING & TRANSACTION FENCES

The platform avoids immediate, greedy one-to-one dispatch allocations. Instead, it buffers incoming requests to perform global multi-objective marketplace optimizations.

### 3.1 Time-Window Optimization Boundaries

Incoming trip requests are buffered into discrete time windows of **200ms to 400ms** to maximize marketplace efficiency. The execution loop triggers immediately when the duration window elapses **OR** when the accumulated volume exceeds **150 concurrent orders** — whichever comes first.

```
OrderCreatedConsumer.StartExecutionPipeline()
        │
        │  FetchMessage() from Kafka topic: order.created
        │
        ├──► Append to orderBuffer []OrderCreatedPayload
        │
        ├──► if len(orderBuffer) >= 150 → triggerBatchFlush() immediately
        │
        └──► if timer (300ms) fires   → processBatchLoop() drains buffer
                                              │
                                              ▼
                                    executeMatchingBatch(batch)
                                    (concurrent goroutine pool)
```

**Batch window configuration** (`internal/dispatch/consumer/order_consumer.go`):
```go
batchWindow:  300 * time.Millisecond, // Configurable 200–400ms window
maxBatchSize: 150,                    // Volume trigger mandate
```

---

### 3.2 Thread-Safe Kafka Commit Accumulators (Storm Prevention)

To prevent network connection contention and out-of-order offset commits, the assignment engine processes orders concurrently using an elastic goroutine pool but handles Kafka offset confirmations in a **single batch-flush cycle** after all goroutines complete:

```go
// internal/dispatch/consumer/order_consumer.go
var (
    collectedMessages []kafka.Message
    mu                sync.Mutex
    wg                sync.WaitGroup
)

for _, order := range orders {
    wg.Add(1)
    go func(o domain.OrderCreatedPayload) {
        defer wg.Done()

        // Execute Spatial Reduction, CH Routing and PostgreSQL Commit Matrix...

        // Safely append the message context after a successful database commit
        mu.Lock()
        collectedMessages = append(collectedMessages, o.KafkaMessageContext)
        mu.Unlock()
    }(order)
}
wg.Wait()

// Execute exactly ONE atomic network flush operation outside the concurrent loop
if len(collectedMessages) > 0 {
    _ = c.kafkaReader.CommitMessages(ctx, collectedMessages...)
}
```

> **Why batch commit:** Committing inside each goroutine individually would produce N separate TCP round-trips to the Kafka broker — one per order — under high concurrency. This also risks partial commits if a goroutine panics mid-batch. The single post-`WaitGroup` commit is atomic from Kafka's perspective.

---

### 3.3 Poison-Pill Starvation Protection

If a marketplace starvation event occurs (zero available drivers within the search radius), the matching engine logs the anomaly and **appends the message context to the commit tracker before returning**. This advances the partition offset, preventing unassigned orders from causing head-of-line blocking loops that stall the consumer group:

```go
// Handle Marketplace Starvation safely without blocking the partition stream
if len(candidates) == 0 {
    log.Printf("Marketplace Starvation: No available drivers near cell %s. Progressing offset.",
        o.PickupH3Cell)
    mu.Lock()
    collectedMessages = append(collectedMessages, o.KafkaMessageContext)
    mu.Unlock()
    return
}
```

---

### 3.4 Relational State-Machine Transaction Fences

To maintain data integrity across distributed nodes, the system implements **State-Driven Optimistic Locking** within the PostgreSQL data tier. Transactions enforce the strict linear order state machine using explicit `WHERE status = 'CREATED'` conditional constraints:

```sql
-- internal/dispatch/consumer/order_consumer.go → commitAssignmentTransaction()
UPDATE orders
SET
    status             = 'ASSIGNED'::order_status_enum,
    assigned_driver_id = $1::uuid,
    assigned_at        = CURRENT_TIMESTAMP
WHERE
    id     = $2::uuid
    AND status = 'CREATED'::order_status_enum;  -- Critical Concurrency Fence
```

If a concurrent rider cancellation or duplicate transaction occurs even a millisecond prior, the query returns `RowsAffected() == 0`. The Go worker intercepts this, rolls back the operational branch via `pgx.ErrNoRows`, and releases any active locks without polluting the downstream Kafka event streams.

**Full transaction scope** (3 statements in a single `pgx.Tx`):

```
BEGIN
  1. UPDATE orders   SET status='ASSIGNED', assigned_driver_id=$1 WHERE id=$2 AND status='CREATED'
  2. UPDATE drivers  SET current_state='ONLINE_EN_ROUTE'          WHERE id=$1
  3. INSERT INTO dispatch_match_logs (order_id, algorithm_used, chosen_driver_id, ...)
COMMIT
```

---

## SECTION 4: TOPOLOGICAL GRAPH ROUTING & CONTEXTUAL INFERENCE

The platform calculates vehicle travel times using real-world road networks and contextual machine learning corrections, rather than straight-line Euclidean shortcuts.

### 4.1 The Residual Learning Pattern

**Two-tier ETA computation:**

- **Tier 1 — Topological Baseline:** The in-memory **Contraction Hierarchies (CH) Service** processes the city's pre-ordered OpenStreetMap road network graph, resolving point-to-point shortest path profiles in less than 10ms.

- **Tier 2 — Contextual Correction Layer:** An **XGBoost Spatial Corrector Model** runs on NVIDIA Triton Inference Server. It evaluates high-dimensional contextual features (hour of day, day of week, localized demand/supply density) to predict a real-time residual offset multiplier:

$$\text{Final Corrected ETA} = \text{Topological CH ETA} \times \text{XGBoost Residual Multiplier}$$

```go
// internal/intelligence/usecase/eta_corrector.go
baseETA, err := uc.baseRouter.ComputeShortestPathETA(ctx, sourceNodeID, targetNodeID)

features := []float32{
    float32(baseETA),
    float32(now.Hour()),
    float32(now.Weekday()),
    demandDensity,
    supplyDensity,
}

multiplier, err := uc.tritonClient.PredictETAMultiplier(inferenceCtx, uc.modelName, "1", features)
correctedETA := baseETA * float64(multiplier)
```

---

### 4.2 High-Velocity Tensor Packing via gRPC

The Go client communicates with Triton using low-overhead gRPC connections over explicit IPv4 address channels (`127.0.0.1:8001`), bypassing loopback resolution delays. Features are packed into a raw binary stream using little-endian byte ordering:

```go
// internal/intelligence/client/triton_client.go
numFeatures := int64(len(features))

// Pack float32 slice directly into a sequence of raw little-endian bytes
byteBuffer := make([]byte, numFeatures*4)
for i, f := range features {
    binary.LittleEndian.PutUint32(byteBuffer[i*4:(i+1)*4], math.Float32bits(f))
}

// Format request input tensor array metadata mapping Triton specifications
inputTensor := &triton.ModelInferRequest_InferInputTensor{
    Name:     "input__0",        // Matches config.pbtxt entry parameters
    Datatype: "FP32",
    Shape:    []int64{1, numFeatures}, // 2D Tabular Array [1, 5]
}
```

**Tensor schema:**

| Index | Feature | Type | Example |
|---|---|---|---|
| 0 | `base_eta_seconds` | float32 | `180.0` |
| 1 | `hour_of_day` | float32 | `8.0` (8 AM) |
| 2 | `day_of_week` | float32 | `1.0` (Monday) |
| 3 | `demand_density` | float32 | `12.5` |
| 4 | `supply_density` | float32 | `7.0` |

---

### 4.3 Multi-Tier Circuit Breaker Fallback Latency Guardrails

To enforce the platform's strict latency limits under heavy load, the scoring pipeline wraps external calls in isolated contexts with dedicated timeouts:

```
[ Total Assignment Batch SLA: < 350ms Context Budget ]
  │
  ├──► [ Spatial Scan Phase: ~2ms (Redis sequential ring) ]
  │
  └──► [ Route Scoring Phase Loop per Candidate ]
        │
        ├──► Contraction Hierarchies Service (< 10ms per query)
        │     └───► Fail? → Fallback: DistanceMeters / 11.1  (walking speed estimate)
        │
        └──► Triton Inference Execution (< 12ms enforced context)
              └───► Fail or timeout? → Fallback: pure topological CH output
```

**Triton circuit breaker** (12ms hard deadline):

```go
// internal/intelligence/usecase/eta_corrector.go
inferenceCtx, cancel := context.WithTimeout(ctx, 12*time.Millisecond)
defer cancel()

multiplier, err := uc.tritonClient.PredictETAMultiplier(inferenceCtx, uc.modelName, "1", features)
if err != nil {
    // CIRCUIT BREAKER FALLBACK: instantly return baseline CH routing output
    log.Printf("[INTELLIGENCE_FALLBACK] Triton inference failed. Using baseline CH ETA: %v", err)
    return baseETA, nil
}
```

**CH routing fallback** (Euclidean distance estimate when graph is disconnected):

```go
// internal/dispatch/matcher/ — greedy_test.go circuit breaker validation
// Fallback ETA = DistanceMeters / 11.1  (≈ 4 km/h walking speed → ~10s per 111m)
fallbackETA := candidate.DistanceMeters / 11.1
```

---

## SECTION 5: TRIPLE-JOB REVENUE STREAM AGGREGATION

The surge pricing system runs **entirely on the event backbone created by the dispatch engine**, requiring zero additional infrastructure clusters at launch.

### 5.1 Streaming Aggregator Mechanics

Three independent consumer jobs run concurrently against the shared Kafka backbone:

**Job 1 — Supply Aggregator** (`internal/surge/aggregator/supply_aggregator.go`):
- Consumes `driver.state.changed` topic
- When a driver enters or leaves availability, adds/removes them from a sliding Redis Sorted Set
- Key: `surge:supply:{city}:cell` with expiration timestamp as score

**Job 2 — Demand Aggregator** (`internal/surge/aggregator/demand_aggregator.go`):
- Consumes `order.created` topic
- Registers incoming order IDs inside a corresponding demand Sorted Set
- Applies a strict **30-second sliding expiration window**

```go
// internal/surge/aggregator/demand_aggregator.go
redisKey           := fmt.Sprintf("surge:demand:{%s}:%s", event.CityPrefix, event.PickupH3Cell)
expirationBoundary := now + int64(s.windowSize.Seconds()) // now + 30

pipe.ZAdd(ctx, redisKey, redis.Z{Score: float64(expirationBoundary), Member: event.OrderID})
pipe.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("(%d", now)) // evict stale
pipe.Expire(ctx, redisKey, s.windowSize*2)                             // keep key alive
```

**Job 3 — Surge Calculator** (`internal/surge/calculator/surge_calculator.go`):
- Runs a background evaluation loop **every 5 seconds**
- Uses a parallel `sync.WaitGroup` pool to fetch the sizes of both sets across active cells in a single pass
- Applies the division-by-zero friction stabilizer and computes localized multipliers:

$$\text{Surge Multiplier} = \max \left( 1.0, \, \min \left( 4.5, \, \frac{\text{Demand Rate}}{\max(0.5,\, \text{Supply Count}) \times 0.7} \right) \right)$$

**Formula test cases:**

| Demand | Supply | Raw | Final |
|---|---|---|---|
| 0 | 0 | — | **1.00** (floor) |
| 5 | 0 | 5 / (0.5 × 0.7) = 14.28 | **4.50** (cap) |
| 10 | 10 | 10 / (10 × 0.7) = 1.43 | **1.43** |
| 2 | 10 | 2 / (10 × 0.7) = 0.29 | **1.00** (floor) |
| 100 | 5 | 100 / (5 × 0.7) = 28.57 | **4.50** (cap) |

```go
// internal/surge/calculator/surge_calculator.go
evalInterval: 5 * time.Second, // Evaluates and flushes pricing grids every 5 seconds
maxSurgeCap:  4.5,             // Hard safety cap preventing extreme pricing anomalies
```

---

### 5.2 Real-Time In-Memory Matrix Joins

The computed multipliers are published directly to the `surge.zone.updated` topic. The **Order Pricing Service** consumes this stream and stores the values in a thread-safe in-memory map protected by a `sync.RWMutex`. This allows fare quote requests to perform instant **O(1)** reads without hitting the database.

```
Kafka: surge.zone.updated
           │
           ▼
OrderPricingService
    surgePriceMatrix map[cityPrefix]map[h3Cell]float64
    (protected by sync.RWMutex)
           │
           ▼
Order creation → matrix[city][pickupH3Cell] → surge_multiplier
               → base_fare_paise × surge_multiplier = final_fare_paise
```

> **Integer currency:** All fares are stored and calculated as **Paise** (INT) — never floating point. This eliminates IEEE 754 rounding errors in financial calculations entirely.

---

## SECTION 6: LOCAL PRODUCTION VERIFICATION TOPOLOGY

To validate this multi-container architecture locally, engineers can deploy the following single-file manifest (`local-dev-topology.yaml`). It provisions the complete infrastructure topology — including the sharded Redis Cluster, PostGIS extensions, and KRaft Kafka brokers — within an isolated `dispatch` namespace.

```yaml
# deploy/local/local-dev-topology.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: dispatch
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-init-script
  namespace: dispatch
data:
  01-init-spatial.sql: |
    CREATE EXTENSION IF NOT EXISTS postgis;

    CREATE TYPE driver_state_enum AS ENUM (
      'ONLINE_AVAILABLE', 'ONLINE_EN_ROUTE', 'ONLINE_DELIVERING', 'OFFLINE', 'BUSY_BATCH'
    );
    CREATE TYPE order_status_enum AS ENUM (
      'CREATED', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'DELIVERING', 'COMPLETED', 'CANCELLED'
    );

    CREATE TABLE regional_cities (
        city_prefix VARCHAR(10) PRIMARY KEY,
        city_name   VARCHAR(100) NOT NULL,
        is_active   BOOLEAN DEFAULT true NOT NULL,
        geofence    GEOGRAPHY(MultiPolygon, 4326)
    );

    CREATE TABLE drivers (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        city_prefix         VARCHAR(10) REFERENCES regional_cities(city_prefix) NOT NULL,
        current_state       driver_state_enum DEFAULT 'OFFLINE' NOT NULL,
        acceptance_rate     NUMERIC(4,3) DEFAULT 1.000 NOT NULL,
        last_known_location GEOGRAPHY(Point, 4326)
    );

    CREATE TABLE orders (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        city_prefix        VARCHAR(10) REFERENCES regional_cities(city_prefix) NOT NULL,
        status             order_status_enum DEFAULT 'CREATED' NOT NULL,
        pickup_location    GEOGRAPHY(Point, 4326) NOT NULL,
        dropoff_location   GEOGRAPHY(Point, 4326) NOT NULL,
        pickup_h3_cell     VARCHAR(15) NOT NULL,
        assigned_driver_id UUID REFERENCES drivers(id),
        base_fare_paise    INT NOT NULL
    );

    CREATE TABLE dispatch_match_logs (
        id                   BIGSERIAL PRIMARY KEY,
        order_id             UUID NOT NULL,
        algorithm_used       VARCHAR(50) NOT NULL,
        chosen_driver_id     UUID NOT NULL,
        computed_eta_seconds INT NOT NULL,
        assignment_score     NUMERIC(10,4) NOT NULL
    );

    CREATE INDEX idx_cities_geofence ON regional_cities USING GIST(geofence);
    CREATE INDEX idx_drivers_location ON drivers USING GIST(last_known_location);
    CREATE INDEX idx_orders_pickup ON orders USING GIST(pickup_location);
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgresql
  namespace: dispatch
spec:
  serviceName: postgresql-service
  replicas: 1
  selector:
    matchLabels:
      app: postgresql
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      containers:
      - name: postgresql
        image: postgis/postgis:15-3.3
        env:
        - name: POSTGRES_USER
          value: "postgres"
        - name: POSTGRES_PASSWORD
          value: "password"
        - name: POSTGRES_DB
          value: "delivery_platform"
        ports:
        - containerPort: 5432
          name: postgres
        volumeMounts:
        - name: postgres-data-vol
          mountPath: /docker-entrypoint-initdb.d
  volumeClaimTemplates:
  - metadata:
      name: postgres-data-vol
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgresql-service
  namespace: dispatch
spec:
  ports:
  - port: 5432
  selector:
    app: postgresql
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-kraft
  namespace: dispatch
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kafka-kraft
  template:
    metadata:
      labels:
        app: kafka-kraft
    spec:
      containers:
      - name: kafka
        image: confluentinc/cp-kafka:7.5.0
        env:
        - name: KAFKA_NODE_ID
          value: "1"
        - name: KAFKA_LISTENER_SECURITY_PROTOCOL_MAP
          value: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT"
        - name: KAFKA_LISTENERS
          value: "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093,EXTERNAL://0.0.0.0:19092"
        - name: KAFKA_ADVERTISED_LISTENERS
          value: "PLAINTEXT://kafka-service.dispatch.svc.cluster.local:9092,EXTERNAL://localhost:19092"
        - name: KAFKA_CONTROLLER_LISTENERS
          value: "CONTROLLER://0.0.0.0:9093"
        - name: KAFKA_INTER_BROKER_LISTENER_NAME
          value: "PLAINTEXT"
        - name: KAFKA_CONTROLLER_QUORUM_VOTERS
          value: "1@0.0.0.0:9093"
        - name: KAFKA_PROCESS_ROLES
          value: "broker,controller"
        - name: KAFKA_LOG_DIRS
          value: "/tmp/kraft-combined-logs"
        - name: CLUSTER_ID
          value: "MkU3OEVBNTcwNTJENDM2Qk"
        ports:
        - containerPort: 9092
          name: internal
        - containerPort: 19092
          name: external
---
apiVersion: v1
kind: Service
metadata:
  name: kafka-service
  namespace: dispatch
spec:
  ports:
  - port: 9092
    targetPort: 9092
    name: internal
  - port: 19092
    targetPort: 19092
    name: external
  selector:
    app: kafka-kraft
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: redis-cluster-config
  namespace: dispatch
data:
  redis.conf: |
    port 6379
    cluster-enabled yes
    cluster-config-file nodes.conf
    cluster-node-timeout 5000
    appendonly yes
    protected-mode no
    bind 0.0.0.0
  bootstrap-cluster.sh: |
    #!/bin/sh
    apk add --no-cache bind-tools
    echo "Waiting for all Redis nodes to resolve..."
    until [ "$(nslookup redis-cluster-nodes.dispatch.svc.cluster.local | grep Address | wc -l)" -eq 7 ]; do
      sleep 2
    done
    IPs=$(nslookup redis-cluster-nodes.dispatch.svc.cluster.local | grep Address | awk '{print $2}' | tail -n 6)
    CLUSTER_NODES=""
    for ip in $IPs; do
      CLUSTER_NODES="$CLUSTER_NODES $ip:6379"
    done
    echo "yes" | redis-cli --cluster create $CLUSTER_NODES --cluster-replicas 1
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-cluster
  namespace: dispatch
spec:
  serviceName: redis-cluster-nodes
  replicas: 6
  selector:
    matchLabels:
      app: redis-cluster
  template:
    metadata:
      labels:
        app: redis-cluster
    spec:
      containers:
      - name: redis
        image: redis:7.2-alpine
        command: ["redis-server", "/usr/local/etc/redis/redis.conf"]
        ports:
        - containerPort: 6379
          name: client
        - containerPort: 16379
          name: gossip
        volumeMounts:
        - name: conf
          mountPath: /usr/local/etc/redis
  volumeClaimTemplates:
  - metadata:
      name: conf
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 100Mi
---
apiVersion: v1
kind: Service
metadata:
  name: redis-cluster-nodes
  namespace: dispatch
spec:
  clusterIP: None
  ports:
  - port: 6379
    name: client
  selector:
    app: redis-cluster
---
apiVersion: batch/v1
kind: Job
metadata:
  name: redis-cluster-init-job
  namespace: dispatch
spec:
  template:
    spec:
      containers:
      - name: cluster-init
        image: redis:7.2-alpine
        command: ["/bin/sh", "/config/bootstrap-cluster.sh"]
        volumeMounts:
        - name: config-volume
          mountPath: /config
      restartPolicy: OnFailure
      volumes:
      - name: config-volume
        configMap:
          name: redis-cluster-config
```

### Infrastructure Bootstrap Sequence

```bash
# Step 1: Deploy all resources into the dispatch namespace
kubectl apply -f deploy/local/local-dev-topology.yaml

# Step 2: Wait for data store readiness
kubectl rollout status statefulset/postgresql  -n dispatch
kubectl rollout status statefulset/redis-cluster -n dispatch
kubectl rollout status deployment/kafka-kraft  -n dispatch

# Step 3: Wait for cluster-init Job to complete
kubectl wait --for=condition=complete job/redis-cluster-init-job -n dispatch --timeout=120s

# Step 4: Establish port-forwards
kubectl port-forward svc/postgresql-service 5432:5432 -n dispatch &
kubectl port-forward svc/kafka-service      19092:19092 -n dispatch &
kubectl port-forward pod/redis-cluster-0    6379:6379 -n dispatch &
kubectl port-forward pod/redis-cluster-1    6380:6379 -n dispatch &
kubectl port-forward pod/redis-cluster-2    6381:6379 -n dispatch &
```

---

## SECTION 7: PRODUCTION DEPLOYMENT & TESTING COMMAND PATTERNS

### 7.1 PowerShell Runtime Injection Commands

Execute this block inside your target PowerShell environment to bind application runtime parameters to your port-forwarded Kubernetes testing infrastructure:

```powershell
# Core Production Target State Parameter Bindings
$env:DATABASE_URL        = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379,127.0.0.1:6380,127.0.0.1:6381"
$env:KAFKA_BROKERS       = "localhost:19092"
$env:GRPC_PORT           = "50051"
$env:ALGORITHM_STRATEGY  = "GREEDY"

# Target IPv4 Loopback to Prevent Triton Handshake Failures
# (empty string = disable ML inference, run in pure Contraction Hierarchies mode)
$env:TRITON_SERVER_ADDR  = "127.0.0.1:8001"

Write-Host "System Operational Environment Hooks are Locked and Active."
```

**Environment Variable Reference:**

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://...@localhost:5432/delivery_platform` | PostgreSQL DSN |
| `REDIS_CLUSTER_NODES` | `127.0.0.1:6379` | Comma-separated Redis node list |
| `KAFKA_BROKERS` | `localhost:19092` | Comma-separated Kafka broker list |
| `GRPC_PORT` | `50051` | Location Ingestion gRPC listen port |
| `ALGORITHM_STRATEGY` | `GREEDY` | `GREEDY` \| `HUNGARIAN` \| `AUCTION` |
| `TRITON_SERVER_ADDR` | `127.0.0.1:8001` | Triton gRPC endpoint (empty = disable ML) |
| `REDIS_IP_MAP` | `` | Pod IP → localhost port mapping for K8s port-forwarding |

---

### 7.2 Core Verification Commands

**Build and run services:**

```bash
# Compile production deployment binaries
go build -o bin/ingestion.exe ./cmd/ingestion/
go build -o bin/dispatch.exe  ./cmd/dispatch/
go build -o bin/simulator.exe ./cmd/simulator/

# Run services (separate terminals)
bin\ingestion.exe   # Location Ingestion gRPC Service on :50051
bin\dispatch.exe    # Dispatch Matching Engine (Kafka consumer)
bin\simulator.exe   # E2E smoke test client
```

**Execute test suites:**

```bash
# Unit tests (no infrastructure required)
go test ./internal/... -v

# End-to-end matching tests (mock gRPC servers, no live infra)
go test -v ./internal/test/...

# Full integration tests (requires live K8s infrastructure)
go test -v -tags=integration ./test/integration/...
go test -v -tags=integration ./internal/...

# Run the full Windows E2E orchestration script
powershell -ExecutionPolicy Bypass -File .\run_e2e_test.ps1
```

**Monitor streaming infrastructure health:**

```bash
# Monitor consumer group lag across the streaming backbone
kafka-consumer-groups.sh \
  --bootstrap-server localhost:19092 \
  --describe \
  --group dispatch-matching-group

# Inspect Redis cluster topology and slot assignments
redis-cli -p 6379 CLUSTER INFO
redis-cli -p 6379 CLUSTER NODES

# Verify PostgreSQL schema and active orders
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM orders GROUP BY status;"
psql $DATABASE_URL -c "SELECT algorithm_used, COUNT(*), AVG(computed_eta_seconds) FROM dispatch_match_logs GROUP BY algorithm_used;"
```

**Switch matching algorithm at runtime** (no restart required — set before launching dispatch service):

```powershell
$env:ALGORITHM_STRATEGY = "HUNGARIAN"  # For 500–5,000 concurrent orders
$env:ALGORITHM_STRATEGY = "GREEDY"     # Default (< 500 concurrent orders)
$env:ALGORITHM_STRATEGY = "AUCTION"    # For 5,000+ concurrent orders
```

---

## APPENDIX: QUICK REFERENCE CHEATSHEET

### Redis Key Patterns

```
driver:{city:driverID}:status          →  ONLINE_AVAILABLE / OFFLINE / ...
driver:{city:driverID}:current_cell    →  H3 cell string (current position)
driver:{city:driverID}:profile         →  HASH { osm_node_id, acceptance_rate, ... }
drivers:zset:{city}:{h3Cell}           →  ZSET { member=driverID, score=unix_ts }
surge:demand:{city}:{h3Cell}           →  ZSET { member=orderID,  score=expiry_ts }
surge:supply:{city}:{h3Cell}           →  ZSET { member=driverID, score=expiry_ts }
```

### Kafka Topics

```
order.created          →  partitioned by city_prefix
order.assigned         →  partitioned by order_id
driver.location.updated→  partitioned by city_prefix
driver.state.changed   →  partitioned by city_prefix
surge.zone.updated     →  partitioned by city_prefix
```

### Cost Function Weights

```
cost = (0.45 × ETA_seconds)
     + (0.25 × (1.0 - acceptance_rate))
     + (0.15 × cancellation_probability)
     + (0.10 × surge_zone_penalty)       // 0.0=inside zone, 1.0=outside zone
     + (0.05 × (1.0 / (idle_seconds+1)))
```

### Timeout Budget

```
Total batch SLA:          < 350ms  (order ctx)
Spatial scan (Redis):     ~  2ms   (7 sequential ZREVRANGEBYSCORE)
CH routing per candidate: < 10ms   (in-memory graph query)
Triton inference:         < 12ms   (hard context deadline → fallback on breach)
PostgreSQL transaction:   < 50ms   (3-statement atomic write)
Kafka emit (async):       non-blocking
```

---

*Document compiled: May 2026 · Module: `github.com/platform/driver-delivery` · Go 1.26.3*
*All code snippets verified against source at `C:\workspace\Driver\internal\` and `C:\workspace\Driver\cmd\`.*
