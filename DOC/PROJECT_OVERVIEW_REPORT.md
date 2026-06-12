# PROJECT OVERVIEW REPORT

## What Is This Project

**Drivers-for-u** is a real-time, multi-region ride-hailing and driver delivery platform. It connects riders (car owners who need a driver) with professional drivers, managing the entire lifecycle from booking and matching through trip execution, payment, and settlement. The system ingests driver telemetry over gRPC, matches orders to drivers using advanced algorithms (Hungarian / Greedy), computes dynamic surge pricing, and exposes everything through a JWT-authenticated API gateway with WebSocket real-time updates.

## User Types

| Role | Description |
|------|-------------|
| **Rider (Car Owner)** | End user who books a driver for their own car. Uses the mobile app (Next.js + Capacitor) to request rides, track trips, manage their garage, make payments, and rate drivers. |
| **Driver** | Professional driver who accepts ride requests. Uses the mobile app to go online/offline, accept offers, navigate to pickups, execute trips, capture odometer/fuel, and manage earnings/payouts. |
| **Operations Manager** | Internal staff who monitors fleet activity, manages trips, handles incidents, and oversees driver compliance. Uses the admin dashboard. |
| **Fleet Manager** | Manages driver onboarding, vehicle compliance, dispatch rules, and fraud lockout. Uses the admin dashboard. |
| **Super Admin** | Full system access with role provisioning, pricing controls, financial audit, and marketplace orchestration capabilities. |
| **Financial Auditor** | Reviews ledger discrepancies, approves refunds, manages wallets, and oversees financial reconciliation. |
| **Support Lead** | Handles stalled trip incidents, claims, and SOS response workflows. |
| **Customer Support** | Manages support tickets, rider/driver issues, and order cancellation/disputes. |
| **City Manager** | Manages city-specific dispatch rules, promo campaigns, and regional pricing. |
| **Marketing Manager** | Creates and manages promo codes, banners, referral programs, and loyalty tiers. |
| **Compliance Officer** | Verifies driver KYC, checks duplicate registrations, and audits onboarding documents. |
| **Analytics** | Views heatmap analytics, driver cell distribution, and promotional performance data. |

## Core Problem Being Solved

The platform solves the problem of connecting car owners who need professional drivers with available, qualified drivers in real-time. Unlike standard ride-hailing (where the platform owns the vehicle), this is a **driver-as-a-service** model -- riders bring their own cars and the platform provides the driver. Key business problems addressed:

1. **Real-time spatial matching** -- Finding the best available driver near a rider's location using H3 hexagonal spatial indexing and advanced matching algorithms.
2. **Dynamic pricing** -- Computing surge multipliers based on live supply/demand across geographic cells.
3. **Trip lifecycle management** -- Managing the full trip state machine from booking through OTP verification, live tracking, and payment settlement.
4. **Fleet compliance** -- Ensuring drivers are KYC-verified, vehicles are insured, and training is completed before going online.
5. **Financial integrity** -- Double-entry bookkeeping ledger for trip settlement, wallet management, and payment reconciliation.
6. **Multi-region operations** -- Supporting multiple cities (Kolkata, Bengaluru) with region-aware routing and cross-region handoffs.

## Primary User Flow

### Rider Flow:
1. **Login** via phone OTP (JWT issued with RIDER role)
2. **Onboarding** -- personal info, add first car to garage, set saved places, emergency contacts
3. **Book a ride** -- select trip type (In-City Round/One-Way, Outstation), choose car from garage, set pickup/drop, apply promo, see fare estimate, tap "Book Driver"
4. **Dispatch search** -- radar animation while system matches a driver (60s countdown)
5. **Driver assigned** -- see driver photo/name/rating/vehicle, ETA to pickup
6. **Live trip** -- real-time map tracking, OTP display, call/chat driver, share trip, SOS
7. **Trip end** -- view bill breakdown, pay via Cash/UPI/Card/Wallet, rate driver (1-5 stars + tags + tip)
8. **Post-trip** -- view receipt/invoice, trip history, rebook

### Driver Flow:
1. **Login/Register** via phone OTP (JWT issued with DRIVER role)
2. **Onboarding** -- 8-step KYC: personal info, address, documents (license, Aadhaar, PAN), vehicle expertise, bank details, emergency contact, agreement signature, training quiz
3. **Go Online** -- toggle duty state, see heatmap and today's stats
4. **Receive offer** -- 15-second countdown popup with rider info, pickup distance, fare estimate
5. **Accept/Decline** -- slide-to-accept or decline with reason (30s cooldown)
6. **En route to pickup** -- navigation, call/chat rider, arrive button
7. **Arrived** -- wait timer, capture start odometer/fuel, verify 4-digit OTP
8. **Trip in progress** -- live map, timer, distance counter, add stops, report issues, SOS
9. **End trip** -- capture end odometer/fuel, view bill, confirm payment (Cash/UPI/Card)
10. **Rate rider** -- 1-5 stars + tags

### Admin Flow:
1. **Login** via email/password (optionally with TOTP 2FA or Google/Apple SSO)
2. **Dashboard** -- live fleet stats, incident queue, dispatch metrics
3. **Manage** -- drivers, riders, vehicles, orders, promos, pricing, finance, support tickets, geofences, fraud, compliance, analytics

## Architecture Diagram

```
                          +-----------------------+
                          |   MOBILE CLIENTS      |
                          |  (Next.js + Capacitor) |
                          | Rider App | Driver App |
                          +-----+--------+--------+
                                |        |
                     gRPC       |        |  WebSocket/HTTP
                     (gps)      |        |
                          +-----v--------v--------+
                          |     CMD/INGESTION     |  <-- gRPC streaming gateway
                          |  (driver telemetry)   |
                          +--+---------+----------+
                             |         |
              +--------------+         +--------------+
              |                                     |
    +---------v---------+             +-------------v-------------+
    |   POSTGRES+POSTGIS|             |    REDIS CLUSTER (6-node) |
    |  (drivers, orders, |             |  (H3 spatial index,       |
    |   ledger, outbox)  |             |   surge matrix, pricing   |
    +----+---------+-----+             |   cache, session state)   |
         |         |                   +-------------+-------------+
         |         |                                 |
    +----v----+ +--v-----------+            +-------v--------+
    | CMD/    | | CMD/NOTIF-   |            | CMD/SURGE      |
    | DISPATCH| | ICATION      |            | (supply/demand |
    | (match  | | (outbox->    |            |  aggregation + |
    |  engine)| |  FCM/APNs)   |            |  calculator)   |
    +----+----+ +--------------+            +-------+--------+
         |                                      |
    +----v--------------------------------------v----+
    |              APACHE KAFKA (KRaft mode)         |
    |  Topics: order.created, order.assigned,        |
    |  driver.location.updated, driver.state.changed, |
    |  surge.zone.updated, trip.waypoint, etc.        |
    +--+-------+-------+-------+-------+------------+
       |       |       |       |       |
  +----v--+ +--v---+ +v-----+ |  +----v-------+
  |CMD/   | |CMD/  | |CMD/  | |  |CMD/PRICING |
  |PRICING| |RECON-| |EXPIRY| |  |(surge cache|
  |(surge | |CILER | |(offer| |  | in-memory) |
  |multi-)| |(self-| |time- | |  +------------+
  +-------+ |heal) | |out)  | |
            +------+ +------+ |
              +-------+       |
              |CMD/   |  +----v--------+
              |REBAL- |  |CMD/ANALYTICS|
              |ANCER  |  |(SSE heatmap)|
              +-------+  +-------------+

    +----------+          +-----------+
    |CMD/TRITON|          |CMD/OSM-   |
    |(XGBoost  |          |PREPROC    |
    | inference|          |(PBF->CSV) |
    +----------+          +-----------+

    +---------------------+
    |   CMD/GATEWAY (BFF) |
    | JWT + WS + REST API |
    +----------+----------+
               |
    +----------v----------+
    |  ADMIN DASHBOARD    |  <-- Vite + React 18 + Tailwind
    |  (fleet ops, pricing|
    |   incidents, heatmap)|
    +---------------------+

    +---------------------+
    |  RIDER/DRIVER APPS  |  <-- Next.js 16 + Capacitor 8
    |  (mobile clients)   |
    +---------------------+

    +---------------------+
    | NVIDIA TRITON SERVER|
    | (XGBoost models:    |
    |  spatial corrector, |
    |  cancellation risk) |
    +---------------------+

    +---------------------+
    | HELM CHART          |
    | (K8s production     |
    |  deployment)        |
    +---------------------+
```

## Tech Stack (Complete)

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **Languages** | Go | 1.25.0 | Backend services (15 microservices) |
| **Languages** | TypeScript | 5.x | Frontend apps (admin + mobile) |
| **Languages** | SQL | - | Database migrations (92+ migrations) |
| **Languages** | Protobuf | - | gRPC contracts (telemetry, triton, stream framing) |
| **Frontend Framework** | Next.js | 16.2.6 | Rider mobile app (static export) |
| **Frontend Framework** | React | 19.2.4 (rider), 18.2.0 (admin) | UI rendering |
| **Frontend Framework** | Vite | 5.2.x | Admin dashboard bundler |
| **Mobile Runtime** | Capacitor | 8.3.4 | Native iOS/Android shell for Next.js app |
| **UI Library** | Tailwind CSS | 4.x (rider), 3.4.x (admin) | Utility-first styling |
| **State Management** | Zustand | 5.0.14 | Client-side state (rider app) |
| **Mapping** | Leaflet + React-Leaflet | 1.9.4 / 5.0.0 | Map rendering (rider app) |
| **Animation** | Framer Motion | 12.40.0 | UI animations (rider app) |
| **Spatial Indexing** | H3 (Uber) | h3-js 4.4.0 / h3-go 3.7.1 | Hexagonal spatial grid |
| **Backend Framework** | Go net/http | stdlib | HTTP routing (Go 1.22+ ServeMux) |
| **Backend gRPC** | google.golang.org/grpc | 1.81.1 | Driver telemetry ingestion |
| **Database** | PostgreSQL | 15 | Primary relational store |
| **Spatial Extension** | PostGIS | 3.3 | Spatial queries and geometry |
| **Cache / Spatial Index** | Redis Cluster | 7.2 | 6-node cluster for H3, surge, sessions |
| **Message Broker** | Apache Kafka | 7.5.0 (Confluent) | Event streaming (KRaft mode, no ZooKeeper) |
| **Kafka Client** | segmentio/kafka-go | 0.4.51 | Go Kafka producer/consumer |
| **ML Inference** | NVIDIA Triton | 24.01 | XGBoost model serving (gRPC) |
| **ML Models** | XGBoost | - | ETA spatial corrector + cancellation risk classifier |
| **ORM / DB Access** | pgx | 5.9.2 | PostgreSQL connection pool and queries |
| **Migration** | golang-migrate | 4.19.1 | Schema migration runner |
| **Auth** | JWT (HS256) | golang-jwt/v5 5.3.1 | API authentication (RIDER, DRIVER, admin roles) |
| **Auth** | TOTP | - | Admin 2FA enrollment |
| **Auth** | SSO (Google, Apple) | - | Admin authentication overlay |
| **Push Notifications** | FCM + APNs | - | Outbox pattern push engine |
| **Object Storage** | AWS S3 | - | KYC document uploads |
| **Encryption** | AES field-level | golang.org/x/crypto | PII encryption (bank details) |
| **Circuit Breaker** | sony/gobreaker | 2.4.0 | Per-dependency circuit breaking (Triton fallback) |
| **Tracing** | OpenTelemetry | 1.44.0 | Distributed context propagation |
| **Metrics** | Prometheus | 1.23.2 (client_golang) | Application metrics |
| **Alerting** | Prometheus AlertManager | - | SLO alert rules |
| **Autoscaling** | KEDA | - | Kafka consumer lag-based scaling |
| **Containerization** | Docker | - | Multi-stage builds (scratch runner) |
| **Orchestration** | Docker Compose | v2 | Local development stack |
| **Orchestration** | Kubernetes | - | Production deployment |
| **Package Manager** | Helm | v2 (Chart v1.0.0) | K8s production charts |
| **Testing** | Go testing | stdlib | Unit + integration tests |
| **Testing** | Jest | 30.4.2 | Frontend tests |
| **Testing** | golangci-lint | latest | Go linter |
| **Road Data** | OpenStreetMap PBF | - | Local routing graph extraction |
| **Routing Algorithm** | Contraction Hierarchies | custom | Shortest-path ETA computation |
| **Matching Algorithm** | Hungarian (Kuhn-Munkres) | custom | Optimal driver-order assignment |
| **Matching Algorithm** | Greedy | custom | Fast fallback matcher |
| **Real-time Streaming** | WebSocket | gorilla/websocket 1.5.3 | Live trip updates, dispatch stream |
| **Real-time Streaming** | SSE | - | Analytics heatmap streaming |
| **Cross-region** | Region Router | custom | Multi-city federation (KOL, BLR) |

## Major Modules

| Module | Description | Status |
|--------|-------------|--------|
| **Ingestion** (`cmd/ingestion`) | gRPC streaming gateway for driver GPS telemetry. Writes to Postgres, indexes into Redis H3 sorted sets, emits `driver.location.updated` to Kafka. | Complete |
| **Dispatch** (`cmd/dispatch`) | Order matching engine. Consumes `order.created`, performs spatial ring scan, evaluates matches (Greedy/Hungarian), persists assignments, emits `order.assigned`. | Complete |
| **Surge** (`cmd/surge`) | Supply/demand aggregation streaming workers. Computes surge multipliers per H3 cell, emits `surge.zone.updated`. | Complete |
| **Pricing** (`cmd/pricing`) | Thread-safe in-memory surge multiplier read model. Consumes `surge.zone.updated`. | Complete |
| **Gateway** (`cmd/gateway`) | JWT-authenticated public API + WebSocket BFF. All client-facing traffic routes through here. Region-aware routing, rate limiting, WS ticket auth. | Complete |
| **Notification** (`cmd/notification`) | Outbox-pattern push notification engine. Reads `outbox_events`, fans out to FCM (Android) and APNs (iOS). | Complete |
| **Analytics** (`cmd/analytics`) | Live spatial heatmap SSE stream. Per-cell density grid exposed at `/api/v1/analytics/heatmap`. | Complete |
| **Reconciler** (`cmd/reconciler`) | Self-healing background repair loop. Detects and fixes drifted dispatch state after partial failures. | Complete |
| **Pruner** (`cmd/pruner`) | Stale telemetry garbage collector. Evicts Redis/Postgres entries older than 30s. | Complete |
| **Expiry** (`cmd/expiry`) | Offer timeout janitor. Times out unaccepted offers, transitions to EXPIRED for re-matching. | Complete |
| **Rebalancer** (`cmd/rebalancer`) | Idle-driver redistribution. Scans idle drivers and emits `RebalancePrompt` events to underserved cells. | Complete |
| **Simulator** (`cmd/simulator`) | Local telemetry + order simulator for dev/test. Streams synthetic driver positions and orders. | Complete |
| **OSM Preprocessor** (`cmd/osm-preprocessor`) | Converts OSM PBF extracts into local routing CSV format for Contraction Hierarchies. | Complete |
| **Migrate** (`cmd/migrate`) | Standalone database migration runner using golang-migrate. | Complete |
| **Routing** (`internal/routing`) | Local road graph loader, Contraction Hierarchies implementation, ETA computation. Google Maps hybrid fallback. | Complete |
| **Intelligence** (`internal/intelligence`) | Triton gRPC client, XGBoost ETA corrector, multi-tier circuit breaker for graceful degradation. | Complete |
| **Telemetry** (`internal/telemetry`) | Domain models, gRPC handler, use case, repos for driver position tracking. Region routing, Redis caching, Kafka production. | Complete |
| **Admin** (`internal/admin`) | 30+ admin portal HTTP handlers: auth, trip, pricing, incident, finance, promo, compliance, dashboard, CMS, ESG, franchise, AI, etc. | Complete |
| **Rider App** (`rider-app/`) | Next.js 16 + Capacitor 8 mobile app for car owners. Login, booking, live trip, account management, garage, wallet, referrals. | ~70% (many pages are static UI) |
| **Admin Dashboard** (`frontend/`) | Vite + React 18 + Tailwind control room for fleet ops, pricing, incidents, live heatmap. | ~60% (core panels exist) |
| **Rider Domain** (`internal/rider`) | Full rider domain: auth, onboarding, booking, promo validation, referrals, WebSocket hub, ride check monitor, repositories. | Complete |
| **Financial Ledger** (`internal/pricing`) | Double-entry bookkeeping, payment webhook reconciliation, wallet management. | Complete |
| **Safety & Emergency** | SOS triggering, fatigue monitoring, ride check anomaly detection, incident panel. | Complete |
| **Offline Sync** | Bulk reconciliation of offline driver data when connectivity resumes. | Complete |
| **Odometer Audit** | Start/end KM and fuel capture with admin audit trail. | Complete |
| **Geofencing** | Operational zone management, dynamic geofence policies. | Complete |
| **Fraud Detection** | Fraud anomaly detection, lockout capabilities, force-match admin controls. | Complete |
| **Marketplace Orchestrator** | Admin controls for force-match, geofence management, fraud lockout. | Complete |

## Project Maturity Assessment

- **Overall stage**: Late Beta / Near Production
- **Estimated completion**: ~75-80%
- **What's built**:
  - Complete backend service mesh (15 Go microservices) with full Docker Compose orchestration
  - 92+ database migrations covering all core domains
  - Full order lifecycle state machine (CREATED -> ASSIGNED -> EN_ROUTE -> DELIVERING -> COMPLETED)
  - Real-time matching engine with Hungarian/Greedy algorithms and circuit-breaker fallback
  - Dynamic surge pricing with supply/demand aggregation
  - JWT-authenticated gateway with region routing, rate limiting, and WebSocket fan-out
  - Outbox-pattern push notifications (FCM/APNs)
  - Live spatial heatmap analytics (SSE)
  - Financial ledger with double-entry bookkeeping
  - Self-healing reconciler, stale telemetry pruner, offer expiry janitor, fleet rebalancer
  - XGBoost ML models for ETA correction and cancellation risk
  - Full admin portal with 30+ handler modules (auth, trips, pricing, incidents, finance, promos, compliance, CMS, ESG, franchise, AI)
  - Rider app with auth, booking, live trip, account management (18+ pages)
  - Driver app with onboarding, duty management, trip execution, earnings
  - Helm chart for Kubernetes production deployment
  - KEDA autoscaling for Kafka consumers
  - Prometheus alert rules for SLO monitoring
  - Chaos engineering test harness
  - OpenTelemetry distributed tracing
  - Multi-region federation (KOL, BLR)
  - 34 completed milestones
- **What's missing**:
  - Many rider/driver account pages are static UI without backend wiring (garage, KYC, wallet, payouts, support, training, insurance, legal)
  - Rider login client path mismatch (`/api/v1/auth/login` vs `/api/v1/auth/rider/login`)
  - SOS route not registered in gateway
  - Object storage (S3) integration for trip photos/documents
  - Payment gateway webhook contracts for real payment providers
  - Financial contracts for promo, D4M Care, tips, subscription plans
  - WebSocket usage inconsistency (needs standardization on ticket-based auth)
  - Admin dashboard is ~60% complete (core panels exist but many sub-features pending)
  - CORS is wildcard (must lock down for production)
  - Region matrix is hardcoded (new regions need code changes)
  - Some dead code (12h pricing sync loop) pending cleanup
- **Biggest gaps**:
  1. **Frontend-backend wiring** -- ~30% of mobile app pages have no real backend integration
  2. **Payment provider integration** -- Payment webhook is stubbed; no real Stripe/Razorpay integration
  3. **Object storage** -- KYC and trip photo uploads fall back to ephemeral local disk
  4. **Production security** -- Wildcard CORS, hardcoded JWT key in docker-compose, query-param region fallback
  5. **Documentation** -- Despite thorough README/SETUP, deeper operational runbooks are sparse

## Technical Vision Summary

The team was building a **production-grade, event-driven, spatially-aware driver delivery platform** modeled after Uber/Ola but for a driver-as-a-service use case (car owners bring their own vehicles). The architectural principles include:

1. **Microservices with single responsibility** -- 15 independently deployable Go services, each owning a specific domain concern (ingestion, dispatch, surge, pricing, notification, etc.).

2. **Event-driven architecture** -- Kafka as the central event backbone with well-defined topic contracts. Every state change flows as an event (order.created, driver.state.changed, surge.zone.updated, etc.).

3. **Spatial-first design** -- H3 hexagonal grid system for driver availability indexing, surge zone computation, and demand/supply aggregation. PostGIS for persistent spatial queries.

4. **Multi-tier intelligence** -- Local Contraction Hierarchies for fast ETA, Google Maps hybrid fallback, Triton XGBoost models for ETA correction and cancellation risk, with circuit-breaker degradation.

5. **CQRS-like separation** -- Write path (Postgres + Kafka) separated from read path (Redis cache, in-memory pricing model, SSE analytics).

6. **Self-healing infrastructure** -- Reconciler detects drifted state, pruner evicts stale entries, expiry times out abandoned offers, rebalancer redistributes idle drivers.

7. **Defense in depth** -- JWT auth, Redis sliding-window rate limiting, field-level encryption for PII, circuit breakers per dependency, chaos testing harness.

8. **Multi-region federation** -- Region router middleware with cross-region handoff events, shared-nothing edge partitioning per city.

9. **Mobile-first with native shell** -- Next.js static export wrapped in Capacitor for iOS/Android, with WebSocket-first real-time communication and offline sync buffers.

10. **Ops-ready from day one** -- Prometheus metrics, OpenTelemetry tracing, Kubernetes Helm charts, KEDA autoscaling, health/readiness probes, structured logging.

The codebase reflects a team with strong distributed systems expertise, building toward a production-ready marketplace platform with comprehensive operational tooling. The 34 completed milestones show systematic feature delivery, though frontend-backend integration and production security hardening remain the critical path to launch.
