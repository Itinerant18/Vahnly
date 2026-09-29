# ADR: Cloudflare Free Tier ($0/month) Platform Migration

- **Status:** Proposed / In-Progress
- **Date:** 2026-09-29
- **Author:** Vahnly Core Engineering

---

## 1. Context and Problem Statement

The Vahnly ride-hailing platform currently runs on a single Google Cloud Platform (GCP) VM (`dfu-stack`, Docker Compose, Caddy, `api.aniket.site`) for its backend services (Go gateway, dispatch, surge, pricing, analytics, notification, background daemons, Redis cluster, Kafka, spatial Postgres, MinIO) plus Firebase Hosting for the three web applications (`rider-app`, `client-app`, `frontend`).

The objective is to eliminate infrastructure hosting costs completely ($0/month) by migrating to a **Cloudflare-only serverless and edge deployment** leveraging Cloudflare Workers, Durable Objects, Queues, R2, KV, Hyperdrive, Workflows, and Pages/Workers Static Assets on the Free Tier, with Neon Free Postgres (PostGIS) as the primary relational and spatial datastore, while keeping Firebase strictly for Auth and FCM.

---

## 2. Decision Summary

1. **API Gateway & Business Logic:** Rewritten from Go into TypeScript on Hono running on Cloudflare Workers (`workers/api`).
2. **State, Locks, Queuing, Geo Indexing:**
   - **Hot stateful operations, locks, WebSockets, rate limiting, and driver geo-spatial indexing** migrate from Redis Cluster to **SQLite-backed Durable Objects** (Hibernation API).
   - **High-frequency messaging** (driver GPS telemetry, location updates, surge updates) is routed via direct DO RPC and DO alarms—never via queues.
   - **Low-volume domain events** (`order.created`, `order.assigned`, `order.cancelled`, `driver.payout.requested`, `support.ticket.created`, `incident.*`, `trip.anomaly`, `driver.rated`) use **Cloudflare Queues** (10k ops/day free).
3. **Database & Connection Pooling:** Neon Free Postgres (0.5 GB, 100 CU-h, PostGIS 16) connected through **Cloudflare Hyperdrive** (`vahnly-pg` pooled with 60 s read query caching and `vahnly-pg-rw` non-cached for writes).
4. **Object Storage:** Migrated from MinIO to **Cloudflare R2** (`vahnly-documents` bucket with prefixes `documents/`, `trip-photos/`, `rider-documents/`, `support-attachments/`). Uploads flow through the Worker (25 MiB cap) or authenticated Worker streaming (`GET /api/v1/files/*`).
5. **Configuration & Read-Mostly Cache:** **Cloudflare KV** (`VAHNLY_CONFIG`) for feature flags, regions matrix, and periodic surge snapshots.
6. **Background Tasks & Daemons:** Consolidated into a single scheduled Worker (`workers/cron`, `* * * * *`, 3 cron triggers) and Cloudflare **Workflows** (`PayoutBatchWorkflow`, `DocExpiryWorkflow`, `WeeklyBackupWorkflow`).
7. **Frontend Applications:** `rider-app` (Next.js export), `client-app` (Next.js export), and `frontend` (Vite) deployed as **Cloudflare Static Assets** on Workers with custom domains and Cloudflare Access on `admin.aniket.site`.

---

## 3. Go Service Responsibility Mapping

| Go Service (`cmd/*`) | Original Role | Migration Target | Architectural Mechanism |
|---|---|---|---|
| `cmd/gateway` | HTTP reverse proxy, REST handlers, WebSockets, JWT/Auth, CORS, Rate limiting, Encryption | `workers/api` (Hono) | Ported routes 1:1 with byte-compatible JSON contracts. WS handled via `OrderStreamDO` and `RiderStreamDO` with Hibernation API. Auth sessions, refresh tokens, OTP counters, and tickets in `SessionDO`. Sliding window in `RateLimitDO`. AES-GCM via `crypto.subtle`. |
| `cmd/dispatch` | Driver spatial index (H3), matching engine, heartbeat, GC, rebalancer | `CityDispatchDO` (`workers/api`) + `workers/cron` | Spatial index in `CityDispatchDO` SQLite (`driver_index` table, `(h3, ts)` index). Greedy matching executed directly inside DO. Heartbeat (15 s), rebalancer (60 s), spatial GC (5 m) as DO alarms. Scheduled-booking sweep runs in `workers/cron`. |
| `cmd/analytics` | SSE heatmap broadcast (`/api/v1/analytics/heatmap`), Redis aggregation | `HeatmapDO` (`workers/api`) | `TransformStream` SSE endpoint with 2 s snapshot alarm and 15 s keepalive comments. Capped at 5 concurrent admin streams. |
| `cmd/surge` | 5 s ticker recalculating supply/demand over H3 cells | `CityDispatchDO` alarm | 5 s DO alarm recalculates metrics from local driver index; writes to KV `surge:{city}` **only when changed** to preserve KV 1k writes/day quota. |
| `cmd/pricing` | Order pricing Kafka consumer & fare calculator | `workers/api` service logic | Synchronous pricing calculation within Worker routes using base formulas and surge multipliers from KV. |
| `cmd/notification` | 2 s outbox ticker, FCM push sender, doc expiry, sandbox payout | `workers/api` + `workers/cron` + `DocExpiryWorkflow` | Outbox drained immediately on insert via `ctx.waitUntil(drainOutbox())` + 60 s fallback sweep in `workers/cron`. FCM HTTP v1 authenticated via RS256 JWT minted with `crypto.subtle`. Doc expiry runs daily via `DocExpiryWorkflow`. Sandbox payout in `workers/cron`. |
| `cmd/expiry` | 5 s offer/order expiration ticker | `workers/cron` | Runs every 60 s via batched SQL `UPDATE orders/offers WHERE expires_at < now()`. |
| `cmd/reconciler` | 15 s order state reconciliation and ledger checks | `workers/cron` | Runs every 60 s (re-emits stuck assignments to Queue) and hourly for ledger checks. |
| `cmd/pruner` | 30 s stale driver/location pruner | `workers/cron` | Runs every 60 s: invokes `CityDispatchDO.sweepStale()` and marks inactive drivers offline in Postgres. |
| `cmd/rebalancer` | 60 s driver rebalancing recommendations | `CityDispatchDO` alarm | 60 s DO alarm computes neighborhood supply imbalances. |
| `cmd/ingestion` | gRPC ingest server (:50051) | **Dropped** | Cloudflare Workers do not terminate raw gRPC. Driver app already transmits GPS via REST (`client-app/src/services/telemetryStream.ts`). |
| `cmd/server` | Legacy unified runner | **Dropped** | Superseded by Cloudflare Workers runtime. |
| `cmd/simulator` | Telemetry & trip simulation | **Retained Offline** | Retained locally/CI as an offline load generation tool updated to send telemetry via HTTP REST. |
| `cmd/osm-preprocessor` | Road network graph extraction | **Retained Offline** | Retained for preprocessing OSM data when required. |
| `cmd/migrate` | Database migrations runner | **Retained in CI/CD** | Migrations in `database/migrations` applied against Neon Postgres using `migrate` CLI in `.github/workflows/cf-deploy-api.yml`. |

---

## 4. Free-Tier Capacity and Quota Budgeting

| Resource | Free Plan Limit | Allocated Usage Pattern | Risk Mitigation |
|---|---|---|---|
| Workers | 100k requests/day | All incoming HTTP & WebSockets upgrade requests | Pilot city scope; caching on static assets and KV |
| CPU Time | 10 ms per invocation | Lightweight Hono handlers; fast returns | Offload heavy work to `ctx.waitUntil` or Workflows |
| Durable Objects | 100k requests/day | Geo indexing, active order streams, session checks | Driver client batches GPS fixes (5 s idle, 2 s on trip) |
| Hyperdrive | 100k queries/day | Neon Postgres queries | 60 s query caching on read-only queries; local DO caching |
| Queues | 10k operations/day | Domain events only (`order.*`, `driver.rated`, etc.) | High-frequency telemetry completely bypasses Queues |
| KV Writes | 1,000 writes/day | Surge snapshots, configuration | Only write surge snapshots when multiplier changes |
| Neon Postgres | 0.5 GB storage | Core transactional relational data | Telemetry logs pruned or exported to R2; PostGIS retained |

---

## 5. Consequences & Trade-offs

- **Positive:** Operating cost drops from ~$40-60/month (GCP VM + network egress) to **$0/month**. Global low-latency edge deployment with automatic DDoS/WAF protection. Zero VM maintenance and zero Docker daemon vulnerabilities.
- **Negative / Constraints:** Free tier caps allow ~60 continuously active drivers (or ~3,000 orders/day) before upgrading to Workers Paid ($5/mo). Neon free tier provides 0.5 GB storage requiring telemetry pruning. Raw gRPC ingestion is dropped in favor of REST.
