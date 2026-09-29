# Vahnly → Cloudflare (free tier) migration prompt

> Paste everything below the line into a fresh Claude Code session opened at the repo root.
> Facts in "Section 0" were verified on 2026-09-29 against Cloudflare / Neon / Upstash docs.
> Re-verify any limit before relying on it; Cloudflare changes free-plan limits several times a year.

---

You are migrating the Vahnly ride-hailing platform (this monorepo) from a single GCP VM
(`dfu-stack`, Docker Compose, Caddy, `api.aniket.site`) plus Firebase Hosting to a
**Cloudflare-only deployment that costs $0/month**. Work in phases, verify every phase with
the check listed, and stop to ask only when a decision is listed as "ASK".

## Section 0 — Ground truth (do not re-research; do re-verify limits if a deploy fails on quota)

### 0.1 What Cloudflare gives for free (Workers Free plan, 2026-09)

| Product | Free limit | Used for |
|---|---|---|
| Workers | 100k requests/day, 10 ms CPU per invocation, 128 MB memory, 64 MiB script, 50 subrequests/req, 6 concurrent outbound connections, 100 Workers/account | API gateway, cron jobs |
| Static assets (Workers or Pages) | Unlimited requests + bandwidth, 20k files/version, 25 MiB/file, 500 Pages builds/month | rider / driver / admin apps |
| Durable Objects (SQLite-backed only on Free) | 100k requests/day, 13,000 GB-s/day, WebSocket msgs billed 20:1, hibernation free, SQLite storage free on Free | WebSocket hubs, driver geo index, locks, rate limits, presence |
| Queues (free since 2026-02-04) | 10,000 operations/day, 24 h retention, 10k queues | Kafka replacement for low-volume domain events only |
| R2 | 10 GB storage, 1M Class A ops, 10M Class B ops per month, zero egress | MinIO replacement (documents, trip-photos, rider-documents, support-attachments) |
| KV | 100k reads/day, 1k writes/day, 1 GB | Feature flags, regions matrix, surge matrix snapshot (read-mostly only) |
| D1 (SQLite) | 5M rows read/day, 100k rows written/day, 5 GB; hard-fails on quota since 2026-09-01 | NOT used (no PostGIS). Optional: audit/log tables |
| Hyperdrive (free since 2025-04) | 100k queries/day, 10 configs, ~20 origin connections, 60 s max query | Pooled connection Workers → Postgres |
| Workflows | 100k requests/day, 3,000 steps/day, 1 GB state, 3-day retention | Multi-step durable jobs (payout batch, doc expiry) |
| Cron Triggers | 5 per account, 3 per Worker, 1-minute minimum, 10 ms CPU per run on Free | All background daemons collapsed into one scheduled Worker |
| Workers Logs | 200k events/day, 3-day retention | Logging |
| Zone (DNS, CDN, TLS, WAF managed rules, rate limiting rule, Turnstile, Email Routing) | Free plan zone | `aniket.site` |
| Cloudflare Tunnel + Access | Tunnel free, Access free ≤ 50 users | Fallback bridge only (Section 6) |
| Containers | **Paid only** (Workers Paid $5/mo) | Not allowed |
| Workers AI | 10k neurons/day free | Optional replacement for Triton models (Section 5.9) |

Sources: developers.cloudflare.com/workers/platform/pricing, /workers/platform/limits,
/changelog/post/2026-02-04-queues-free-plan, /changelog/post/2025-04-08-hyperdrive-free-plan,
/changelog/post/2026-09-01-d1-free-tier-limit-enforcement, /changelog/post/2026-09-04-increased-worker-size-limit,
/durable-objects/platform/pricing, /workflows/reference/pricing, /r2/pricing, /containers/pricing.

### 0.2 What Cloudflare does NOT give for free, and the chosen substitute

| Need | Cloudflare has | Decision |
|---|---|---|
| Postgres + PostGIS | No (D1 is SQLite) | **Neon Free** (0.5 GB/project, 100 CU-h, PostGIS via `CREATE EXTENSION postgis`, scale-to-zero) behind **Hyperdrive**. Supabase Free is the fallback (pauses after 7 idle days, so not preferred). |
| Redis Cluster | No | **Durable Objects** for everything stateful and hot; **KV** for read-mostly config. Do not add Upstash unless a DO pattern is impossible (Upstash Free = 500k cmds/month, 256 MB, REST API works from Workers). |
| Kafka | Queues (10k ops/day) | Queues **only** for `order.created`, `order.assigned`, `order.cancelled`, `driver.payout.requested`, `support.ticket.created`, `incident.*`, `trip.anomaly`, `driver.rated`. High-frequency topics (`driver.location.updated`, `driver.state.changed`, `surge.zone.updated`) become **direct Durable Object RPC / DO alarms**, never Queue messages. |
| Long-running Go processes | No free container | Backend is **rewritten as TypeScript Workers** (Hono). Go stays in the repo for reference and for the offline `osm-preprocessor`. Go-on-Workers via WebAssembly (syumai/workers-go) is rejected: Go wasm init alone exceeds the 10 ms CPU budget on Free and cannot host Durable Objects. |
| gRPC server (ingestion :50051) | Workers cannot terminate gRPC | Drop. Driver app already posts GPS over REST (`client-app/src/services/telemetryStream.ts`). Simulator gets an HTTP mode. |
| Triton | No | Off. Dispatch already falls back to baseline ETA / risk 0.0 when `TRITON_SERVER_URL` is empty. Optionally port the two models to Workers AI later. |
| FCM service account | n/a | Works from a Worker: mint a Google OAuth2 JWT with `crypto.subtle` (RS256) and call FCM HTTP v1. |

### 0.3 Existing system facts (from the codebase; file refs are for you to read, not to guess)

- Gateway: Go, `cmd/gateway/main.go` (routes ~L557-L840), handlers in `internal/gateway/delivery/http/handler.go`, rider in `internal/rider/**`, driver in `internal/driver/**`, admin in `internal/admin/**`.
- WebSockets: `GET /api/v1/dispatch/stream?order_id&ticket` (driver/admin; protobuf `AssignmentFrame`/`TelemetryFrame` from `api/proto/v1/stream_framing.proto` + JSON passthrough for `fare_estimate`, `incident_type`, `chat_message`, `rider_location`; admin uses `order_id=global-sos`) and `GET /ws/rider?ticket` (`internal/rider/realtime/hub.go`, 25 s ping). Tickets: `POST /api/v1/ws/ticket`, single-use GETDEL in `internal/gateway/middleware/ws_ticket.go`.
- SSE: `GET /api/v1/analytics/heatmap` proxied from `cmd/analytics` (2 s broadcast, 15 s keepalive); admin `EventSource` in `frontend/src/admin/ControlRoomDashboard.tsx:154`.
- Redis usage (all `*redis.ClusterClient`, 49 files): H3-cell zsets `drivers:zset:{city}:{h3}` (main geo index), `GEOADD driver:locations:{region}` (3 writers, no geo reads), pub/sub `gateway:assignments:broadcast` / `gateway:telemetry:broadcast` / `gateway:rider:broadcast` / `trip.status_changed`, sliding-window rate limit `ratelimit:*`, idempotency `idem:*`, sessions `driver:session:{id}`, refresh tokens `refresh:*`/`refreshidx:*`, OTP counters, locks (`notification:lock:fence:*`, `driver:payout:cooldown:*`), `dispatch:heartbeat` (60 s TTL), GPS write-behind buffer `orders:gps:active_buffers` (flushed every 15 s), Distance Matrix cache, surge matrix. One Lua script (`internal/dispatch/consumer/handoff_consumer.go:25`, LWW CAS).
- Kafka topics + consumer groups: see `internal/dispatch/consumer/order_consumer.go`, `cmd/gateway/main.go:1475`, `internal/pricing/service/order_pricing_service.go:54`, `internal/surge/**`, `internal/analytics/service/heatmap_service.go:36`. Gateway `/health` and `/ready` dial Kafka and return degraded if it is down.
- Postgres: `postgis/postgis:15-3.3`, pgx/v5, 202 golang-migrate files in `database/migrations` (also auto-run on dispatch boot, `cmd/dispatch/main.go:49`). PostGIS used: `GEOGRAPHY(Point/MultiPolygon,4326)`, `GEOMETRY(Polygon/Point,4326)`, `ST_GeographyFromText`, `ST_X/ST_Y`, `ST_Distance`, `ST_GeomFromText/EWKT`, `ST_SetSRID`, `ST_MakePoint`, `ST_AsGeoJSON`, `ST_Covers`, 3 GIST indexes, advisory locks (expiry, doc-expiry, payout batch). H3 is computed in Go (`uber/h3-go/v3`), not in SQL.
- Object storage: hand-written SigV4 in `internal/storage/objectstore/s3.go`; env `S3_ENDPOINT/S3_BUCKET/S3_REGION/S3_FORCE_PATH_STYLE/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY`; presigned PUT 15 min (onboarding), presigned GET 10 min (admin KYC); gateway refuses boot without S3 unless `ALLOW_LOCAL_OBJECT_STORE=true`.
- Push: FCM HTTP v1 from `cmd/notification` draining table `notification_outbox` (2 s ticker); env `FCM_SERVICE_ACCOUNT_FILE`. No SMS, no email providers (stubs). Firebase Auth ID-token verify in `internal/firebaseauth/verify.go` (env `FIREBASE_PROJECT_ID`). Google tokeninfo checks in driver/rider auth. Admin SSO Google + Apple (`internal/admin/delivery/http/sso.go`, `sso_apple.go`).
- Payments: one HMAC-SHA256 webhook `POST /api/v1/payments/webhook`, secret `PAYMENT_WEBHOOK_SIGNING_SECRET`. No provider SDK.
- Maps: Google Distance Matrix (dispatch only, `internal/routing/google/maps_client.go`, Redis-cached) with in-memory CH graph fallback; OSRM/Nominatim optional (`OSRM_BASE_URL`, `NOMINATIM_BASE_URL`); frontends use OSM/Carto/OpenFreeMap tiles + Leaflet/maplibre.
- Daemons (`cmd/*`): dispatch (consumer + 30 s scheduled-booking sweep + 15 s heartbeat + 5 m spatial GC), surge (5 s calc), pricing (consumer), analytics (2 s SSE), expiry (5 s), reconciler (15 s), pruner (30 s), rebalancer (60 s), notification (2 s outbox, 24 h doc-expiry, 60 s sandbox payout), gateway-internal tickers (GPS flush 15 s, ride-check 30 s, metrics 30 s, KPI snapshot hourly).
- Required gateway env at boot: `JWT_SECRET_SIGNING_KEY`, `FIELD_ENCRYPTION_KEY`, S3 config, `SUPPORTED_REGIONS_MATRIX` (or `regional_cities` rows). Full list in `cmd/gateway/main.go` (env is read ad hoc; there is no config package).
- Frontends: `rider-app` and `client-app` are Next.js 16 `output: "export"` → `out/`; `frontend` is Vite → `dist/`. Each has `firebase.json` with SPA rewrite, `/assets/**` immutable cache, and security headers (X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS, Permissions-Policy). `client-app/firebase.json` also has three 301 redirects (`/driver/account/*` → `/driver-account/*`). Env prefixes `NEXT_PUBLIC_*` / `VITE_*` (API URL, WS URL, analytics URL, Firebase web config, FCM VAPID key, Google Maps key, Sentry DSN, gRPC-web URL which becomes unused).
- Firebase stays for **Auth (phone OTP + Google) and FCM only**. Hosting moves to Cloudflare. Project `vahnly-platform`.
- Domains: `api.aniket.site`, `rider.aniket.site`, `driver.aniket.site`, `admin.aniket.site`. Frontend env files reference `https://api.aniket.site` and `wss://api.aniket.site`.
- CI: `.github/workflows/{backend-ci,rider-app-ci,driver-app-ci,admin-ci,vm-deploy,deploy,release,mobile-build}.yml`. `deploy.yml` (k8s) is already a no-op; `vm-deploy.yml` is what ships prod today.

### 0.4 Free-tier capacity math (write this into `DEPLOYMENT.md`; it decides when $5/mo Workers Paid becomes necessary)

- Driver GPS at 1 msg / 3 s over WebSocket = 28,800 msgs/driver/day = 1,440 billed DO requests/driver/day → **~60 drivers online 24 h** saturate DO's 100k/day. Mitigate: client sends GPS every 5 s while idle, every 2 s only when on-trip; batch 3 fixes per frame.
- Every REST call is 1 Worker request; the Worker → DO hop is another DO request. Budget: 100k Worker + 100k DO per day ≈ a pilot city, not production. Document the upgrade trigger: Workers Paid ($5/mo) lifts Workers to 10M req/month, DO to 1M req/month, removes the 10 ms CPU cap (30 s), Queues to 1M ops/month.
- Hyperdrive 100k queries/day: every request that hits Postgres counts. Cache reads (regions, flags, driver profile) in DO/KV.
- Queues 10k ops/day (write + read + ack each count): keep to ≤ 3,000 orders/day of domain events.
- Neon Free 0.5 GB: `driver_locations` / telemetry history and `notification_outbox` must be pruned (pruner cron) or moved to R2 as daily JSONL exports.

## Section 1 — Target architecture

```
aniket.site (Cloudflare zone, Free)
├─ rider.aniket.site   → Worker "vahnly-rider"  (static assets, rider-app/out)
├─ driver.aniket.site  → Worker "vahnly-driver" (static assets, client-app/out)
├─ admin.aniket.site   → Worker "vahnly-admin"  (static assets, frontend/dist, behind Cloudflare Access)
└─ api.aniket.site     → Worker "vahnly-api"    (Hono, TypeScript)
       ├─ Hyperdrive  → Neon Postgres + PostGIS (schema = database/migrations)
       ├─ R2 bucket   vahnly-documents (+ trip-photos, rider-documents, support-attachments as prefixes)
       ├─ KV          VAHNLY_CONFIG (flags, regions matrix, surge snapshot)
       ├─ Queues      vahnly-domain-events (+ vahnly-domain-events-dlq)
       ├─ Durable Objects
       │    ├─ CityDispatchDO   (one per city prefix, e.g. KOL): H3 driver index, matching, surge calc, heartbeat, rebalancer, spatial GC (alarm)
       │    ├─ OrderStreamDO    (one per order_id, + "global-sos"): driver/admin WebSocket, assignment + telemetry fan-out, GPS write-behind buffer (alarm flush 15 s)
       │    ├─ RiderStreamDO    (one per rider_id): rider WebSocket, trip events, 25 s ping
       │    ├─ HeatmapDO        (one per city): SSE fan-out for /api/v1/analytics/heatmap
       │    ├─ RateLimitDO      (one per key: ip / driver / rider): sliding window
       │    ├─ SessionDO        (one per driver / admin): session, refresh tokens, OTP counters, WS tickets, idempotency keys
       │    └─ LockDO           (one per lock name): SETNX-style fences with TTL
       ├─ Workflows   PayoutBatchWorkflow, DocExpiryWorkflow
       └─ Cron (single Worker "vahnly-cron", `* * * * *`): expiry (5 s → 60 s), reconciler, pruner, notification outbox drain, sandbox payout, KPI snapshot, scheduled-booking sweep
Firebase (kept): Auth (phone + Google), FCM. Firebase Hosting decommissioned.
```

Regional placement: pin Durable Objects and Hyperdrive origin to Asia (Neon region `ap-southeast-1` Singapore is the closest free region; Cloudflare DOs auto-place near first request, Kolkata users will land them in India/Singapore). Set `placement = { mode = "smart" }` on the API Worker.

## Section 2 — Phase plan

Each phase: implement → run the listed check → commit. Do not start the next phase with a red check.

### Phase 1 — Account, zone, tooling (no code)

1. Cloudflare account, Free plan. Add zone `aniket.site`; move nameservers from the current registrar. Verify: `dig NS aniket.site` shows `*.ns.cloudflare.com`.
2. Zone settings: SSL/TLS **Full (strict)**, Always Use HTTPS on, HSTS on (matches the app's header), TLS 1.2 minimum, WebSockets on (Network tab), Brotli on, Bot Fight Mode on, WAF managed ruleset (Free) on.
3. Rate limiting rule (Free plan gives one): 100 req / 10 s per IP on `api.aniket.site/api/v1/auth/*` → block 10 s. Keep the in-app RateLimitDO as the fine-grained limiter.
4. Turnstile site for `admin.aniket.site` login and rider/driver OTP request forms (free). ASK before adding Turnstile to the mobile (Capacitor) flows; on native it needs the Turnstile SDK.
5. Cloudflare Access (Zero Trust Free, ≤ 50 users): application `admin.aniket.site`, policy = allow emails on the admin allowlist via Google IdP or one-time PIN. Keeps the admin SPA off the public internet in addition to the app's own SSO.
6. Tooling: `npm i -g wrangler@latest`, `wrangler login`, create an API token (template "Edit Cloudflare Workers" + Zone DNS Edit + R2 Edit + Queues Edit + Hyperdrive Edit) and store it as GitHub secret `CLOUDFLARE_API_TOKEN`; also `CLOUDFLARE_ACCOUNT_ID`.
7. Check: `wrangler whoami` prints the account; `curl -sI https://aniket.site` returns `server: cloudflare`.

### Phase 2 — Data layer

1. Neon: project `vahnly`, region `ap-southeast-1`, Postgres 16. Run `CREATE EXTENSION IF NOT EXISTS postgis;` in the SQL editor and record the PostGIS version. If the extension is refused on Free, STOP and ASK (fallback is Supabase Free, same 500 MB).
2. Apply the 202 migrations: `migrate -path database/migrations -database "$NEON_URL" up` (golang-migrate CLI; the Go `cmd/migrate` also works). Fix any migration that depends on `pg_advisory_lock` semantics only if it fails; Neon supports advisory locks.
3. Data copy from the VM: `pg_dump --no-owner --no-privileges --data-only` of `delivery_platform` on `dfu-stack` (see memory note "Prod DB access": psql via base64 pipe into `spatial_postgres_dev`), `psql "$NEON_URL" < dump.sql`. Truncate telemetry history tables first if the dump exceeds ~300 MB; keep orders, drivers, riders, ledger, documents metadata, `regional_cities`.
4. Hyperdrive: `wrangler hyperdrive create vahnly-pg --connection-string="$NEON_URL"` (use the **pooled** Neon host `-pooler`). Enable query caching with default 60 s max-age; mark all write queries with `SET LOCAL` or use a non-cached second Hyperdrive config `vahnly-pg-rw` for writes.
5. R2: `wrangler r2 bucket create vahnly-documents`. Object keys keep the four old bucket names as prefixes (`documents/`, `trip-photos/`, `rider-documents/`, `support-attachments/`) so the DB `document_url` columns need a single prefix rewrite. Copy existing MinIO objects with `rclone sync minio:documents r2:vahnly-documents/documents` (rclone R2 backend, S3-compatible API token from R2 → Manage API tokens). Set CORS on the bucket for `https://driver.aniket.site`, `https://rider.aniket.site`, `https://admin.aniket.site` (PUT, GET, HEAD).
6. KV: `wrangler kv namespace create VAHNLY_CONFIG`. Seed keys `flags`, `regions_matrix` (from `SUPPORTED_REGIONS_MATRIX`), `surge:{city}` (JSON snapshot).
7. Queues: `wrangler queues create vahnly-domain-events` and `vahnly-domain-events-dlq`; `max_retries 3`, `max_batch_size 10`, `max_batch_timeout 5`.
8. Check: `psql "$NEON_URL" -c "select postgis_version(); select count(*) from orders;"`; `wrangler r2 object get vahnly-documents/documents/<any-key>` works; `wrangler queues list` shows both.

### Phase 3 — API Worker (`workers/api`)

Create `workers/api` (pnpm/npm workspace at repo root is fine; do not touch the Go module).

**Stack:** Hono 4, TypeScript strict, `postgres` (porsager) or `pg` via Hyperdrive binding (`env.HYPERDRIVE.connectionString`), `zod` for request validation, `jose` for JWT (HS256 with `JWT_SECRET_SIGNING_KEY`, RS256 verify for Firebase/Google), `@bufbuild/protobuf` compiled from `api/proto/v1/stream_framing.proto` so WebSocket frames stay byte-compatible with the current apps, `hono/cors`.

`wrangler.toml` bindings: `HYPERDRIVE` (`vahnly-pg`), `HYPERDRIVE_RW`, `DOCS` (R2), `CONFIG` (KV), `EVENTS` (queue producer + consumer with `dead_letter_queue`), DO namespaces for the seven classes in Section 1 with `new_sqlite_classes` migrations, `compatibility_date = "2026-09-01"`, `compatibility_flags = ["nodejs_compat"]`, `[placement] mode = "smart"`, `[observability] enabled = true`, `routes = [{ pattern = "api.aniket.site", custom_domain = true }]`.

Secrets (`wrangler secret put`): `JWT_SECRET_SIGNING_KEY`, `FIELD_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `APPLE_OAUTH_*`, `FIREBASE_PROJECT_ID` (var, not secret), `FCM_SERVICE_ACCOUNT_JSON` (the full JSON as one secret; the Worker signs a JWT with `crypto.subtle` and exchanges it at `oauth2.googleapis.com/token`, scope `https://www.googleapis.com/auth/firebase.messaging`, cache the access token in SessionDO for 50 min), `GOOGLE_MAPS_API_KEY`, `PAYMENT_WEBHOOK_SIGNING_SECRET`, `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (only for presigned URLs; see below), `SENTRY_DSN`. Non-secret vars: `ACCESS_TOKEN_TTL=4h`, `ALLOWED_ORIGINS`, `ADMIN_COOKIE_SAMESITE`, `ADMIN_FRONTEND_URL`, `APP_VERSION`, `OSRM_BASE_URL`, `NOMINATIM_BASE_URL`, `CITY_PREFIX=KOL`, `SURGE_TRACKED_CELLS`.

**Route port order** (port routes 1:1 from `cmd/gateway/main.go`; keep paths, methods, status codes, JSON shapes, and error bodies identical so the three frontends need only a URL change):

1. `GET /health`, `GET /ready` — return `{"status":"ok"}`; "degraded" only if Hyperdrive ping fails. No Kafka/Redis checks.
2. `GET /api/v1/config/flags` (KV) — this is the existing smoke-test URL.
3. Auth: driver phone/OTP + Google, rider phone/OTP + Google, `POST /api/v1/auth/firebase/verify` (verify against `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`, cache certs in KV 1 h), refresh, logout, cross-tab logout. Sessions/refresh tokens/OTP counters live in `SessionDO` (SQLite table with expiry column; alarm sweeps expired rows).
4. Middleware: CORS from `ALLOWED_ORIGINS`, security headers (`internal/gateway/middleware/cors.go`), rate limit via `RateLimitDO` (fail-open unless `RATE_LIMIT_FAIL_CLOSED=true`), idempotency via `SessionDO`, field encryption (AES-GCM with `FIELD_ENCRYPTION_KEY` via `crypto.subtle`; confirm the Go implementation's format in `internal/**/crypto*` and stay byte-compatible so existing rows decrypt).
5. Orders/booking (rider), driver duty/location/trip, offers, cancel fees, ratings, incidents/SOS, support tickets, payouts, admin routes. Every Kafka `produce` becomes either `env.EVENTS.send(...)` (low-volume topics, Section 0.2) or a DO RPC (`CityDispatchDO.driverStateChanged()`, `CityDispatchDO.locationUpdate()`, `HeatmapDO.push()`).
6. `POST /api/v1/driver/location` → `CityDispatchDO(city).locationUpdate(driverId, lat, lng, ts)` which updates an SQLite table `driver_index(driver_id PK, h3 TEXT, lat, lng, ts)` with an index on `(h3, ts)` (replaces `drivers:zset:{city}:{h3}` and `GEOADD`), then forwards to `OrderStreamDO(activeOrderId).telemetry(frame)`. Use `h3-js` (pure JS, same resolution as the Go code, check `internal/telemetry/**` for the resolution constant).
7. WebSockets: `GET /api/v1/dispatch/stream` and `GET /ws/rider` → validate ticket (`SessionDO.consumeTicket`, single use), then `OrderStreamDO(order_id)` / `RiderStreamDO(rider_id)` `fetch()` with `acceptWebSocket()` (Hibernation API, tags = role). Presence = `getWebSockets().length`. If no socket is present when an assignment arrives, insert into `notification_outbox` (same as `handler.go:513`). Rider ping every 25 s via alarm; use `setWebSocketAutoResponse` for protocol pings. `order_id=global-sos` maps to `OrderStreamDO("global-sos")`.
8. SSE `GET /api/v1/analytics/heatmap` → `HeatmapDO(city)` returns a `TransformStream` readable; DO alarm every 2 s writes the snapshot, keepalive comment every 15 s. Track open streams in memory; a DO holding open SSE streams is not hibernated, so cap concurrent admin streams at 5.
9. Object storage: uploads go **through the Worker** to R2 (`env.DOCS.put`) with the 25 MiB/file limit, replacing presigned PUT; reads use presigned GET generated with `aws4fetch` against the R2 S3 endpoint (`https://<account>.r2.cloudflarestorage.com`), or, simpler, a Worker route `GET /api/v1/files/*` that checks auth and streams from R2. Prefer the Worker route (no R2 API keys in the Worker). Rewrite existing `document_url` values from `http://minio:9000/documents/...` to `documents/...` keys in one migration.
10. Maps: Distance Matrix calls cached in `CityDispatchDO` SQLite (`dm_cache(key, json, expires)`); OSRM/Nominatim pass-through unchanged; the CH graph fallback is not portable (2.7 GB CSV) → use haversine × 1.3 as the fallback ETA, and note it in `DEPLOYMENT.md`.
11. Payments webhook: HMAC-SHA256 with `crypto.subtle`, constant-time compare, unchanged header name.
12. Queue consumer (`queue()` handler in the same Worker): `order.created` → `CityDispatchDO(city).match(order)` (greedy strategy from `internal/dispatch/**`, `ALGORITHM_STRATEGY=GREEDY`); `order.assigned`/`order.cancelled` → `OrderStreamDO` + `RiderStreamDO` fan-out (replaces the Kafka→Redis pub/sub bridge); `driver.payout.requested` → `PayoutBatchWorkflow`; `support.ticket.created`, `incident.*`, `trip.anomaly`, `driver.rated` → persist + `notification_outbox`.
13. Surge: `CityDispatchDO` alarm every 5 s recomputes supply/demand for `SURGE_TRACKED_CELLS` from its own SQLite tables and writes `surge:{city}` to KV **only when changed** (KV = 1k writes/day). Pricing reads KV.
14. Region handoff (`global.region.handoffs`, LWW CAS Lua script): becomes `CityDispatchDO(fromCity).handoff(driver) → CityDispatchDO(toCity).accept(driver, version)` with the CAS done inside the target DO's single-threaded SQLite transaction.

**Check:** `wrangler dev --remote` then run `e2e/` against `http://localhost:8787` (see `run_e2e_test.ps1`); `GET /api/v1/config/flags` = 200; a driver WebSocket receives an `AssignmentFrame` after `POST /api/v1/orders` (use the existing API test procedure in memory note "Dispatch verified"). Also `wrangler deploy --dry-run --outdir dist` and confirm bundle < 64 MiB and CPU per request < 10 ms in `wrangler tail` (`cpuTime` field) for the 10 hottest routes.

### Phase 4 — Cron Worker (`workers/cron`)

One Worker, one trigger `* * * * *`, binds to the same DOs/Hyperdrive/Queue via `service` bindings to `vahnly-api` (or share the code as a workspace package). Each minute it runs, with a per-job LockDO fence and a 10 ms CPU budget (offload anything heavier to a Workflow):

| Old daemon | New schedule | Notes |
|---|---|---|
| expiry (5 s) | every 60 s | offer timeouts; UPDATE ... WHERE expires_at < now() in one statement |
| reconciler (15 s) | every 60 s | re-emit stuck `order.assigned` to Queue; ledger check hourly (`*/60`) |
| pruner (30 s) | every 60 s | `CityDispatchDO.sweepStale()` + mark offline in Postgres |
| notification outbox (2 s) | every 60 s **and** on-demand: the API Worker calls `ctx.waitUntil(drainOutbox())` right after inserting, so pushes stay near-real-time | FCM HTTP v1 |
| sandbox payout (60 s) | every 60 s, only if `PAYOUT_SANDBOX_AUTOSETTLE=true` | |
| doc-expiry (24 h) | `0 3 * * *` (second trigger) → `DocExpiryWorkflow` | |
| KPI snapshot (hourly) | `0 * * * *` (third trigger) | |
| scheduled-booking sweep (30 s) | every 60 s | `SCHEDULED_DISPATCH_LEAD_MINUTES` |
| dispatch heartbeat / spatial GC / rebalancer | DO alarms inside `CityDispatchDO` (15 s / 5 m / 60 s) | not cron |
| GPS write-behind flush (15 s) | `OrderStreamDO` alarm | not cron |

That is 3 triggers on one Worker (limit 3/Worker, 5/account). Check: `wrangler tail vahnly-cron` shows one run per minute with `outcome: ok`, and `notification_outbox` drains within 60 s.

### Phase 5 — Frontends → Cloudflare static assets

For each of `rider-app`, `client-app`, `frontend`:

1. Add `wrangler.toml` next to `package.json`:
   ```toml
   name = "vahnly-rider"          # vahnly-driver / vahnly-admin
   compatibility_date = "2026-09-01"
   [assets]
   directory = "./out"            # ./dist for frontend
   not_found_handling = "single-page-application"
   html_handling = "auto-trailing-slash"   # rider/driver have trailingSlash: true
   ```
2. Port `firebase.json` headers to `public/_headers` (Cloudflare static-asset syntax):
   ```
   /*
     X-Frame-Options: DENY
     X-Content-Type-Options: nosniff
     Referrer-Policy: strict-origin-when-cross-origin
     Strict-Transport-Security: max-age=31536000; includeSubDomains
     Permissions-Policy: camera=(), microphone=(), geolocation=(self)
   /assets/*
     Cache-Control: public, max-age=31536000, immutable
   /_next/static/*
     Cache-Control: public, max-age=31536000, immutable
   ```
   and `client-app` redirects to `public/_redirects`:
   ```
   /driver/account/referrals  /driver-account/refer/     301
   /driver/account/insurance  /driver-account/vehicles/  301
   /driver/account/*          /driver-account/:splat     301
   ```
   Next.js `output: "export"` copies `public/` into `out/`, Vite copies `public/` into `dist/`, so both files ship automatically.
3. Env: `NEXT_PUBLIC_API_URL=https://api.aniket.site`, `NEXT_PUBLIC_WS_URL=wss://api.aniket.site`, `NEXT_PUBLIC_ANALYTICS_URL=https://api.aniket.site`, remove `NEXT_PUBLIC_GRPC_URL` / `NEXT_PUBLIC_GRPC_WEB_URL` / `VITE_GRPC_WEB_URL` usages. Firebase web config and VAPID key unchanged. Keep `firebase.json` files until Phase 8 (rollback path).
4. Custom domains: `wrangler deploy` then Workers → Settings → Domains & Routes → add `rider.aniket.site` etc. (or `routes = [{ pattern = "rider.aniket.site", custom_domain = true }]` in `wrangler.toml`). Cloudflare creates the DNS record and certificate.
5. Firebase Auth: add the three new domains under Firebase Console → Authentication → Settings → Authorized domains, and to the Google OAuth client's authorized JavaScript origins / redirect URIs. Phone-auth reCAPTCHA needs this or sign-in fails.
6. FCM service worker (`firebase-messaging-sw.js`) must be served with `Service-Worker-Allowed` default scope at site root; verify it is in `out/`.
7. Capacitor: update `capacitor.config.ts` `server.url`/allowed navigation if it points at `*.web.app`; `google-services.json` / plist need no change (Firebase project unchanged).
8. Check: each site loads over its custom domain, `curl -sI https://rider.aniket.site | grep -i strict-transport`, phone OTP login works on rider and driver, admin login works through Access + app SSO, `EventSource` heatmap streams in the admin control room.

### Phase 6 — Bridge period (keep the VM alive until Phase 8 passes)

Do not delete the VM until the new stack has served real traffic for 7 days.

- Optional zero-cost belt-and-braces: install `cloudflared` on `dfu-stack` and expose the old gateway as `api-legacy.aniket.site` via a Tunnel (free, no open ports). Frontends can be flipped back by changing one env var and redeploying.
- Dual-write is not needed: the Neon copy in Phase 2 is a point-in-time cut-over. Schedule the cut-over at low traffic, re-run the `pg_dump` delta (orders/ledger tables by `updated_at > cutover_start`) right before switching DNS for `api.aniket.site` to the Worker.

### Phase 7 — CI/CD

Replace `vm-deploy.yml` and the manual Firebase deploys:

- `.github/workflows/cf-deploy-api.yml`: on push to `main` touching `workers/**` or `database/migrations/**` → `npm ci` → `npm test` → `migrate up` against Neon (secret `NEON_DATABASE_URL`) → `cloudflare/wrangler-action@v3` with `command: deploy` for `workers/api` then `workers/cron` → smoke `curl -f https://api.aniket.site/api/v1/config/flags`.
- `.github/workflows/cf-deploy-web.yml`: matrix over the three apps, path-filtered, `npm run build` → `wrangler-action deploy`. Preview deployments for PRs: `wrangler versions upload` and comment the preview URL.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_DATABASE_URL`. Frontend `NEXT_PUBLIC_*`/`VITE_*` go in GitHub **variables** (they are public at build time anyway).
- Mark `deploy.yml` (k8s) and `vm-deploy.yml` as `workflow_dispatch`-only with a deprecation comment; delete after Phase 8. `release.yml` (GHCR images) and `mobile-build.yml` stay.
- Check: a PR touching `rider-app` posts a preview URL; merging to `main` updates `rider.aniket.site` within 3 minutes.

### Phase 8 — Cut-over, observability, decommission

1. Flip DNS for `api.aniket.site` to the Worker custom domain (Workers → Domains). TTL is Cloudflare-managed; propagation is immediate on the edge.
2. Observability: Workers Logs on (free, 3-day retention); Sentry DSNs kept in the apps and added to the Worker via `toucan-js`; create a Cloudflare Notification (free) for "Workers usage approaching limit" and "Origin error rate" so the 100k/day ceiling is not discovered by users. Add a `GET /api/v1/health/quota` admin route that reads `env.CONFIG` counters maintained by a tiny DO to show today's request usage.
3. Backups: Neon Free keeps 6 h of point-in-time restore; add a weekly cron trigger? No, cron limit is 5 per account and 3 are used. Instead a `DocExpiryWorkflow` sibling `WeeklyBackupWorkflow` triggered from the Sunday run of the `0 3 * * *` job: `COPY ... TO STDOUT` per critical table via Hyperdrive → `env.DOCS.put("backups/<date>/<table>.csv")`. R2 free 10 GB covers a year of weekly dumps at the current DB size.
4. After 7 clean days: `firebase hosting:disable` for the three sites (Auth/FCM unaffected), delete the GCP VM `dfu-stack` and its static IP, remove `GCP_SA_KEY` from GitHub secrets, delete `deploy/vm-setup.sh` and `deploy/gcp-vm-setup.md`, update `DEPLOYMENT.md` and `README.md` (the "Ships to" table, the deploy commands, the capacity math from Section 0.4), run `graphify update .`.
5. Final check: `e2e/` green against production; Cloudflare dashboard shows all four Workers with 0 errors over 24 h; GCP billing shows $0 forecast.

## Section 3 — Rules for the implementing agent

- Ship the smallest working slice per phase. No new abstractions for one call site. No feature flags for code paths that have only one branch.
- Keep HTTP contracts byte-identical to the Go gateway; frontends change only env URLs. When a Go handler does something you cannot replicate in 10 ms CPU, split it: respond fast, finish in `ctx.waitUntil` or a Workflow step.
- Every Durable Object stores state in its SQLite (`this.ctx.storage.sql`), never in instance fields alone (hibernation loses them). Every DO with WebSockets uses the Hibernation API.
- Never put a Kafka-style high-frequency stream on Queues; the 10k ops/day cap will fail the whole platform by mid-morning.
- Do not use D1 for anything spatial. Do not use KV for anything written more than a few hundred times per day.
- Migrations stay in `database/migrations` and stay golang-migrate compatible; add new ones with the same numbering.
- Do not commit secrets. `wrangler secret put` for Workers, GitHub secrets for CI, `.dev.vars` (git-ignored) locally.
- Free-plan quota exceeded is an outage: every phase ends with the capacity numbers written into `DEPLOYMENT.md`.
- ASK before: choosing Supabase over Neon, adding Upstash, adding Turnstile to native apps, upgrading any plan, deleting the VM.
- Write an `ADR-cloudflare-migration.md` in `DOC/` listing each Go service and where its responsibility landed (Worker route / DO / cron / Workflow / dropped).
