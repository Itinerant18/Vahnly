+-----------------------------------------------------------------------+
| **ENTERPRISE ARCHITECTURE DOCUMENT**                                  |
|                                                                       |
| **Driver Delivery Platform**                                          |
|                                                                       |
| Real-Time Dispatch & Surge Pricing System Design                      |
|                                                                       |
| Version 1.0 · May 2026 · Confidential                                 |
+-----------------------------------------------------------------------+

+-----------------+-----------------+-----------------+-----------------+
| **Scale         | **Cities**      | **Latency SLA** | **Team Size**   |
| Target**        |                 |                 |                 |
|                 | **10+ Cities**  | **\< 500ms**    | **4--10         |
| **10K--100K     |                 |                 | Engineers**     |
| Drivers**       |                 |                 |                 |
+-----------------+-----------------+-----------------+-----------------+

+--------+-------------------------------------------------------------+
| **01** | **Executive Summary**                                       |
|        |                                                             |
|        | Strategic context and design rationale                      |
+--------+-------------------------------------------------------------+

This document defines the enterprise architecture for a driver delivery
platform designed to operate at scale across 10+ cities with
10,000--100,000 active drivers. The design is explicitly sequenced to
prioritize the real-time dispatch matching engine as the foundational
system, with the surge pricing data pipeline built on top of the event
infrastructure it creates.

+-----------------------------------------------------------------------+
| **Core Design Principle**                                             |
|                                                                       |
| Surge pricing is a feature. Dispatch matching is the platform. The    |
| distributed data pipeline for surge pricing is a consumer of the      |
| dispatch event stream --- not a peer system. Building in any other    |
| order means building on sand.                                         |
+-----------------------------------------------------------------------+

**Design Priorities**

  ----------------------------------------------------------------------------
  **Priority**     **System Component**         **Rationale**
  ---------------- ---------------------------- ------------------------------
  1 --- Critical   Real-Time Dispatch Matching  Heartbeat of the platform; all
  Path             Engine                       other systems depend on it

  2 ---            Kafka Event Streaming Bus    Shared backbone; enables surge
  Infrastructure                                pipeline at near-zero added
                                                cost

  3 --- Revenue    Surge Pricing Data Pipeline  Consumers dispatch events;
  Layer                                         latency tolerance allows
                                                phased build

4 ---            ML ETA & Demand Prediction   Upgrades accuracy; not
  Intelligence                                  required for launch
  ----------------------------------------------------------------------------

+--------+-------------------------------------------------------------+
| **02** | **System Overview**                                         |
|        |                                                             |
|        | Uber-pattern phases mapped to driver delivery               |
+--------+-------------------------------------------------------------+

The architecture is modelled on the three-phase matching system proven
at scale by Uber, adapted for the specific constraints of a driver
delivery platform: asymmetric order-to-driver ratios, package-size
constraints, multi-drop routing, and enterprise SLA requirements.

**Three-Phase Architecture**

  ---------------------------------------------------------------------------
  **Phase**   **Uber Pattern**            **Your Platform Equivalent**
  ----------- --------------------------- -----------------------------------
  Phase 1     Spatial Grid Reduction ---  Driver location index in Redis
              H3 hexagonal indexing       Cluster + H3 grid; O(1) proximity
              limits driver search to     lookup at 100K driver scale
              proximate cells

  Phase 2     ML Predictive ETAs --- Road ETA model seeded from OpenStreetMap
              graph + velocity matrix +   graph; upgrades to proprietary
              real-time context           model in Phase 3

Phase 3     Combinatorial Batch         Greedy nearest-driver at launch;
              Optimization --- Weighted   Hungarian algorithm upgrade at 10K+
              bipartite graph, discrete   concurrent orders
              time windows
  ---------------------------------------------------------------------------

**Data Flow Summary**

The end-to-end flow from order creation to driver assignment operates
across five sequential stages:

- Order ingestion: customer order arrives via API Gateway, validated
    and published to Kafka topic order.created

- Spatial reduction: Order Matching Service queries H3 grid index in
    Redis to retrieve candidate drivers within configurable radius
    (default: 3km)

- ETA scoring: Candidate driver set passed to ETA Service; scores
    computed against road graph with real-time traffic overlay

- Batch optimization: Orders batched in 200--400ms windows; optimizer
    solves assignment using weighted objective function (ETA +
    acceptance rate + surge zone)

- Assignment dispatch: Winner published to Kafka topic order.assigned;
    driver notified via push + WebSocket; order state machine
    transitions to ASSIGNED

+--------+-------------------------------------------------------------+
| **03** | **Phase 1: Spatial Indexing**                               |
|        |                                                             |
|        | H3 geospatial grid and driver state management              |
+--------+-------------------------------------------------------------+

Spatial indexing is the first and most critical performance gate in the
matching pipeline. Without it, finding candidate drivers requires
scanning all active drivers in a city --- an O(N) operation that becomes
untenable at 50K+ drivers. The H3 hexagonal grid reduces this to O(1).

**H3 Hexagonal Grid Design**

- Resolution 8 hexagons (\~0.7 km² per cell) for urban density zones;
    Resolution 7 (\~5 km²) for suburban/rural coverage

- Each driver location update writes to Redis key:
    driver:{city}:{h3_cell}:{driver_id} with 30-second TTL

- Order matching queries the target cell plus all 6 neighbouring cells
    --- covers \~5km radius in one Redis SMEMBERS call

- City boundaries encoded as H3 cell sets; cross-boundary queries
    handled at the regional router layer

**Driver Location Ingestion**

Driver mobile clients emit GPS updates every 4 seconds over a persistent
gRPC connection. The Location Ingestion Service is stateless and
horizontally scalable:

- Connection capacity: 1 gRPC server pod handles \~8,000 concurrent
    driver connections

- At 100K drivers: 13 pods required (scale-to-zero during off-peak
    hours via KEDA)

- Each update: validate GPS bounds, compute H3 cell, write to Redis,
    publish to Kafka topic driver.location.updated

- Stale driver detection: Kafka Streams job flags drivers with no
    update in 45 seconds as OFFLINE

+-----------------------------------------------------------------------+
| **Redis Cluster Configuration**                                       |
|                                                                       |
| Driver state must live in memory. At 100K drivers with 4-second       |
| update intervals, that is 25,000 writes/second to Redis. Use Redis    |
| Cluster with 6 shards (3 primary + 3 replica), consistent hashing by  |
| city prefix. Never use Redis Sentinel for this workload --- it adds   |
| 1--3 seconds of failover lag that violates your sub-500ms SLA.        |
+-----------------------------------------------------------------------+

**Driver State Machine**

  -----------------------------------------------------------------------
  **State**           **Description**                    **Redis TTL**
  ------------------- ---------------------------------- ----------------
  ONLINE_AVAILABLE    Driver active, no current order    30 seconds

  ONLINE_EN_ROUTE     Driver assigned, moving to pickup  120 seconds

  ONLINE_DELIVERING   Driver en route to drop-off        120 seconds

  OFFLINE             No location update for 45+ seconds Evicted

BUSY_BATCH          Assigned but available for         60 seconds
                      secondary order
  -----------------------------------------------------------------------

+--------+-------------------------------------------------------------+
| **04** | **Phase 2: Predictive ETA Estimation**                      |
|        |                                                             |
|        | Road graph, velocity matrix, and real-time scoring          |
+--------+-------------------------------------------------------------+

ETA accuracy is the single biggest driver of dispatch quality. Assigning
the nearest driver by straight-line distance produces poor outcomes ---
a driver 1.2km away across a river may have a longer ETA than one 2.1km
away on a direct road. The ETA Service must compute road-graph-based
travel time, not Euclidean distance.

**Road Graph Architecture**

- Base graph: OpenStreetMap export per city, preprocessed into a
    compressed adjacency graph stored in a read-only in-memory service
    (Neo4j or custom GraphDB)

- Edge weights: static speed limits adjusted by a real-time velocity
    matrix updated every 60 seconds from driver probe data

- Shortest-path algorithm: Contraction Hierarchies (CH) for sub-10ms
    query time on city-scale graphs (superior to Dijkstra for repeated
    queries on static topology)

- Traffic overlay: Kafka consumer aggregates probe speeds by road
    segment; weights recomputed and pushed to graph service as
    differential updates

**ETA Scoring Pipeline**

For each order, the ETA Service receives a candidate driver set
(typically 8--25 drivers) from the spatial index and must score all of
them within the overall 500ms budget:

  ------------------------------------------------------------------------
  **Stage**       **Operation**                        **Latency Budget**
  --------------- ------------------------------------ -------------------
  1\. Graph       Load pre-computed CH nodes for       \< 5ms
  lookup          pickup coordinates

  2\.             Parallel CH query from all candidate \< 30ms
  Multi-source    driver positions to pickup
  query

  3\. Traffic     Apply velocity matrix to raw graph   \< 5ms
  adjustment      ETAs

  4\. Feature     Append driver acceptance rate,       \< 10ms
  enrichment      cancellation rate, surge zone

  5\. Score       Return ranked candidate list to      \< 5ms
  output          Matching Engine

Total ETA       End-to-end per batch                 \< 55ms
  Service
  ------------------------------------------------------------------------

**Phase 2 → Phase 3 ML Upgrade Path**

The launch architecture uses the deterministic CH algorithm. At 6-month
mark (Phase 3), this is upgraded to an ML model trained on historical
trip data:

- Features: hour-of-day, day-of-week, weather, local events,
    historical congestion by segment

- Model: Gradient Boosted Trees (XGBoost) with 15-minute temporal
    resolution per road segment

- Serving: TensorFlow Serving or Triton Inference Server; model
    updates every 6 hours without service restart

- Fallback: CH algorithm remains hot-standby; automatic failover if ML
    service p99 latency exceeds 40ms

+--------+-------------------------------------------------------------+
| **05** | **Phase 3: Combinatorial Batch Optimization**               |
|        |                                                             |
|        | Bipartite matching, objective function, and batch windows   |
+--------+-------------------------------------------------------------+

The matching engine solves a many-to-many assignment problem: given N
available drivers and M pending orders in a city zone at a given moment,
find the globally optimal assignment that minimises total cost across
the entire marketplace --- not just each individual order in isolation.

**Batch Window Design**

Rather than assigning each order the moment it arrives (greedy), the
engine accumulates orders in discrete time windows and solves them
together:

- Window size: 200--400ms (configurable per city density; denser
    cities use shorter windows)

- Window trigger: whichever comes first --- window duration elapsed,
    OR batch size exceeds 150 orders

- Orders older than 2 windows (800ms) are promoted to priority queue
    and assigned greedily to avoid starvation

- During surge events, window size compresses to 150ms to maintain
    responsiveness under high order volume

**Weighted Bipartite Graph**

The optimizer constructs a bipartite graph G = (Drivers ∪ Orders, Edges)
where each edge weight encodes the multi-objective cost of assigning
driver D to order O:

+-----------------------------------------------------------------------+
| **Objective Function**                                                |
|                                                                       |
| Cost(D→O) = α·ETA + β·(1 - AcceptanceRate) +                          |
| γ·CancellationProbability + δ·SurgeZonePenalty + ε·DriverIdleTime     |
| Default weights: α=0.45, β=0.25, γ=0.15, δ=0.10, ε=0.05 Weights are   |
| tunable per city via feature flags without redeployment.              |
+-----------------------------------------------------------------------+

**Algorithm Selection by Scale**

  -----------------------------------------------------------------------
  **Order Volume**    **Algorithm**                   **Complexity**
  ------------------- ------------------------------- -------------------
  Launch: \< 500      Greedy nearest-driver (lowest   O(N log N) ---
  concurrent orders   ETA wins)                       sub-millisecond

  Growth: 500--5,000  Hungarian Algorithm (optimal    O(N³) ---
  concurrent orders   bipartite matching)             acceptable at this
                                                      range

Scale: 5,000+       Auction Algorithm or            O(N² log N) ---
  concurrent orders   Approximate NN with LP          required above 5K
                      relaxation
  -----------------------------------------------------------------------

The matching engine is designed with a strategy pattern: algorithm
selection is a runtime configuration, not a code change. The launch
deployment ships all three algorithms; promotion is triggered by a
feature flag when concurrent order thresholds are crossed.

+--------+-------------------------------------------------------------+
| **06** | **Event Infrastructure**                                    |
|        |                                                             |
|        | Kafka topology and the shared event backbone                |
+--------+-------------------------------------------------------------+

Kafka is the load-bearing infrastructure of this architecture. It serves
three roles simultaneously: the real-time event bus for dispatch, the
data source for surge pricing computation, and the audit log for
compliance and replay. Design it correctly at Phase 1 and the surge
pricing pipeline is largely pre-built.

**Topic Topology**

  ---------------------------------------------------------------------------
  **Topic**                 **Partitioning**   **Consumers**
  ------------------------- ------------------ ------------------------------
  driver.location.updated   By city (1         Matching Engine, Surge
                            partition per      Pricing, Analytics
                            city)

  order.created             By city            Matching Engine, Notification
                                               Service

  order.assigned            By order_id        Driver App, Customer App,
                                               State Machine

  order.status.updated      By order_id        Customer App, Analytics,
                                               Billing

  driver.state.changed      By city            Surge Pricing, Dashboard

surge.zone.updated        By city            Order Pricing Service, Driver
                                               App
  ---------------------------------------------------------------------------

**Surge Pricing as a Kafka Consumer**

The surge pricing pipeline requires zero additional infrastructure
beyond what dispatch already creates. It is implemented as three Kafka
Streams jobs consuming existing topics:

- Job 1 --- Supply aggregator: Consumes driver.state.changed; computes
    available driver count per H3 zone per 30-second window

- Job 2 --- Demand aggregator: Consumes order.created; computes order
    request rate per H3 zone per 30-second window

- Job 3 --- Surge calculator: Joins supply and demand streams; applies
    surge multiplier formula; publishes to surge.zone.updated

- Simple surge formula at launch: multiplier = max(1.0, demand_rate /
    (supply_count \* 0.7)) --- tunable per city

+-----------------------------------------------------------------------+
| **Why This Matters for Team Size**                                    |
|                                                                       |
| With 4--10 engineers, you cannot afford to build two independent data |
| pipelines. The Kafka-first architecture means the surge pricing       |
| system is essentially free once dispatch is live --- it is three      |
| Kafka Streams jobs consuming topics that already exist. Estimated     |
| engineering effort: 1 engineer, 2 weeks, after dispatch is            |
| production-stable.                                                    |
+-----------------------------------------------------------------------+

+--------+-------------------------------------------------------------+
| **07** | **Infrastructure & Resilience**                             |
|        |                                                             |
|        | Distributed deployment, failure modes, and SLA protection   |
+--------+-------------------------------------------------------------+

At 10+ cities with a sub-500ms SLA, infrastructure resilience is not
optional. The most common failure modes in dispatch systems are not
algorithm bugs --- they are state management failures under partial
network partition, Redis leader elections, and cascading timeouts during
demand spikes.

**Regional Deployment Architecture**

- Each city runs as an independent regional cluster: dedicated Kafka
    brokers, Redis Cluster shards, and Matching Engine pods

- Cross-city coordination is handled only at the API Gateway layer
    (order routing, driver roaming at city boundaries)

- Kubernetes (EKS or GKE) with geo-aware node pools per city;
    Horizontal Pod Autoscaler on Matching Engine pods

- Service mesh (Istio or Linkerd) for mTLS between services and
    circuit-breaker policy enforcement

**Critical Failure Recovery Paths**

  ------------------------------------------------------------------------
  **Failure Mode**    **Detection**      **Recovery Action**
  ------------------- ------------------ ---------------------------------
  Redis primary       Sentinel/Cluster   Automatic replica promotion;
  failure             health check \< 5s matching degrades to DB fallback
                                         for 15--30s

  Kafka broker loss   Consumer lag spike Rebalance to surviving brokers;
                      \> 10,000 messages orders replay from offset on
                                         recovery

  Matching Engine pod Kubernetes         Pod restart \< 30s; in-flight
  crash               liveness probe     batch discarded, orders re-queued
                                         via Kafka

  ETA Service         p99 latency \>     Circuit breaker opens; fallback
  overload            80ms               to straight-line distance ETA for
                                         affected batch

City-wide GPS       Driver update rate Last-known position used for up
  outage              drops \> 60%       to 90 seconds; DEGRADED mode
                                         alert triggered
  ------------------------------------------------------------------------

**Observability Stack**

- Metrics: Prometheus + Grafana; key SLIs: match latency p50/p95/p99,
    batch window fill rate, driver assignment rate, ETA accuracy

- Tracing: Jaeger or Grafana Tempo; trace every order from ingestion
    to assignment across all services

- Alerting: PagerDuty integration; alert on p99 match latency \> 400ms
    for 2 consecutive minutes

- Audit log: All match decisions written to immutable S3-compatible
    object store via Kafka Connect; required for enterprise SLA disputes

+--------+-------------------------------------------------------------+
| **08** | **Implementation Roadmap**                                  |
|        |                                                             |
|        | Phased delivery plan for a team of 4--10 engineers          |
+--------+-------------------------------------------------------------+

The roadmap is sequenced to deliver the minimum viable dispatch engine
as fast as possible, then layer intelligence and revenue features on top
of the same infrastructure. No phase requires a rewrite of the previous
phase.

+-----------------------------------------------------------------------+
| **Phase 1: Foundation --- Dispatch Core** \| Months 1--3              |
+-----------------------------------------------------------------------+
| -   Driver Location Ingestion Service (gRPC, 100K concurrent          |
|     connections)                                                      |
|                                                                       |
| -   H3 geospatial index in Redis Cluster                              |
|                                                                       |
| -   Greedy matching engine (nearest available driver, lowest ETA)     |
|                                                                       |
| -   Kafka event bus: core topics defined and operational              |
|                                                                       |
| -   Order State Machine with idempotent assignment (prevents          |
|     double-dispatch)                                                  |
|                                                                       |
| -   Basic observability: Prometheus metrics, structured logging       |
|                                                                       |
| -   Single-city deployment on Kubernetes                              |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Phase 2: Reliability & Multi-City** \| Months 3--6                  |
+-----------------------------------------------------------------------+
| -   Regional deployment: independent cluster per city, geo-aware      |
|     routing                                                           |
|                                                                       |
| -   Road graph ETA Service (OpenStreetMap + Contraction Hierarchies)  |
|                                                                       |
| -   Batch optimization window (200--400ms) replacing per-order greedy |
|     dispatch                                                          |
|                                                                       |
| -   Basic surge pricing: 3 Kafka Streams jobs on existing topics (2   |
|     weeks effort)                                                     |
|                                                                       |
| -   Circuit breakers and fallback modes for all critical service      |
|     paths                                                             |
|                                                                       |
| -   Distributed tracing (Jaeger) and SLA alerting (PagerDuty)         |
|                                                                       |
| -   Enterprise audit log to object storage via Kafka Connect          |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Phase 3: Intelligence Layer** \| Months 6--12                       |
+-----------------------------------------------------------------------+
| -   ML-based ETA model (XGBoost) trained on historical trip data      |
|                                                                       |
| -   Hungarian Algorithm upgrade for orders exceeding 500 concurrent   |
|                                                                       |
| -   Advanced surge pricing: demand prediction, zone-level multiplier  |
|     tuning                                                            |
|                                                                       |
| -   Driver positioning signals: predictive rebalancing during demand  |
|     forecast events                                                   |
|                                                                       |
| -   Multi-tenancy: isolated routing rules per enterprise client       |
|                                                                       |
| -   Full Flink/Spark Structured Streaming for complex surge analytics |
+-----------------------------------------------------------------------+

+--------+-------------------------------------------------------------+
| **09** | **Technology Stack**                                        |
|        |                                                             |
|        | Recommended components and rationale                        |
+--------+-------------------------------------------------------------+

  ------------------------------------------------------------------------
  **Layer**       **Technology**         **Rationale**
  --------------- ---------------------- ---------------------------------
  Driver          gRPC + Protocol        10x more efficient than REST for
  connection      Buffers                high-frequency location updates

  Geospatial      Redis Cluster + H3     Sub-millisecond proximity
  index           (Uber)                 queries; H3 battle-tested at Uber
                                         scale

  Event streaming Apache Kafka (or       De facto standard; Redpanda for
                  Redpanda)              simpler ops with smaller team

  Road graph      Custom CH graph        OpenStreetMap base; Neo4j
                  service                acceptable if team lacks graph
                                         expertise

  Stream          Kafka Streams (Phase   No separate cluster required;
  processing      1--2)                  Flink upgrade in Phase 3

  Container       Kubernetes (EKS/GKE)   KEDA for event-driven autoscaling
  orchestration                          on Kafka consumer lag

  Service mesh    Istio or Linkerd       mTLS, circuit breakers, traffic
                                         policies between services

  Observability   Prometheus + Grafana + Open-source stack; avoids vendor
                  Jaeger                 lock-in at this stage

  Object storage  S3-compatible (AWS     Immutable audit log via Kafka
                  S3/MinIO)              Connect; cheap at scale

ML serving      Triton Inference       Handles XGBoost and future neural
  (Phase 3)       Server                 models; GPU-ready
  ------------------------------------------------------------------------

+--------+-------------------------------------------------------------+
| **10** | **Key Risks & Mitigations**                                 |
|        |                                                             |
|        | Design-time decisions that prevent operational failures     |
+--------+-------------------------------------------------------------+

  -------------------------------------------------------------------------
  **Risk**         **Impact**         **Mitigation**
  ---------------- ------------------ -------------------------------------
  State management Double-dispatch,   Idempotency keys on all Kafka
  under partial    lost orders        consumers; distributed locking
  failure                             (Redlock) for assignment commit

  Redis leader     Match latency      Never use Redis Sentinel; use Redis
  election during  spike \> SLA       Cluster with automatic failover \< 5
  peak load                           seconds

  Cross-city       Driver falls       API Gateway handles boundary
  driver roaming   between regional   detection; driver re-registered in
                   clusters           new city cluster on first update

  Kafka consumer   Order backlog      Monitor lag with Burrow; KEDA
  lag under load   builds faster than autoscales Matching Engine pods on
  spike            dispatch           consumer group lag metric

  ETA model        Poor match quality Weekly automated retraining pipeline;
  degradation over                    A/B test new models against CH
  time                                baseline before full rollout

Small team       Incident response  Automate runbooks for top 5 failure
  operational      bandwidth          modes; aim for zero-touch recovery on
  overload at 10+  exhausted          Redis and Kafka failures
  cities
  -------------------------------------------------------------------------
