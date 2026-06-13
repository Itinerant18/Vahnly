# Performance Optimization Pass

Date: 2026-06-13

This pass was scoped against the **actual** codebase rather than the original task
template. A large share of the template's items were already implemented or did not
apply (the schema/endpoints it assumed differ from reality). What was real and
actionable is below, followed by what was skipped and why.

---

## Changes applied

### Backend — database

- **`000101_add_orders_rider_created_index`** + **`000102_add_orders_status_city_created_index`** (new)
  - `idx_orders_rider_created` on `orders (rider_id, created_at DESC)` — rider trip
    history (`ListOrders`) previously had only single-column `idx_orders_rider`, forcing
    a sort over matched rows.
  - `idx_orders_status_city_created` on `orders (status, city_prefix, created_at DESC)` —
    admin trips list (`trip_handler`) filters status + city_prefix and sorts by
    `created_at DESC`; the only prior index was partial (`status='CREATED'` only).
  - Both built with **`CREATE INDEX CONCURRENTLY`** so they take no write lock on a large
    production `orders` table. Each index lives in its **own migration file (one statement
    each)**: golang-migrate's postgres driver execs a whole file as a single simple query,
    and a multi-statement query runs inside an implicit transaction block — which
    `CONCURRENTLY` forbids. One statement per file keeps each out of any transaction.
  - Operational caveat of `CONCURRENTLY` + golang-migrate: if an index build fails midway it
    leaves an `INVALID` index and marks the migration dirty; drop the invalid index and
    re-run. (Acceptable trade for not locking writes.)

### Backend — connection pools

Pools are configured per-service in `cmd/*/main.go` (no shared helper). Applied the
**safe** tuning — added connection lifetimes, kept existing pool **sizes** so no service's
throughput regresses:

| Service | MaxConns | MinConns | MaxConnLifetime | MaxConnIdleTime |
|---|---|---|---|---|
| gateway (`cmd/gateway/main.go`) | 20 *(was default)* | 5 *(was default)* | 1h *(new)* | 30m *(new)* |
| dispatch (`cmd/dispatch/main.go`) | 20 *(unchanged)* | 4 *(unchanged)* | 1h *(new)* | 30m *(was 15m)* |
| ingestion (`cmd/ingestion/main.go`) | 50 *(unchanged)* | 10 *(unchanged)* | 1h *(new)* | 30m *(was 15m)* |

`ingestion` keeps its intentionally-higher pool (sized for ~100K active drivers).
`MaxConnLifetime=1h` ensures connections recycle (helps with stale conns / failover).

### Backend — Redis pipelining

- `internal/surge/aggregator/supply_aggregator.go` (`GetAvailableDriverCount`)
- `internal/surge/aggregator/demand_aggregator.go` (`GetRecentDemandRate`)

Each batched a `ZRemRangeByScore` (stale cleanup) + `ZCard` (count) on the same key into a
single `Pipeline().Exec()` — halves the round-trips on a hot surge-read path. Both commands
target the same hash slot, so they are cluster-pipeline-safe.

### Backend — API caching

- `internal/gateway/delivery/http/driver_features_handler.go` (`ListTraining`,
  `GET /api/v1/driver-account/training`): added `Cache-Control: private, max-age=300`
  (per-driver, near-static catalogue).

### Frontend — admin dashboard (Vite, `frontend/`)

- `frontend/vite.config.ts`: added `build.rollupOptions.output.manualChunks` splitting
  `vendor-react`, `vendor-map` (leaflet/react-leaflet), `vendor-router`. Recharts is **not**
  a dependency of the admin app, so it is intentionally not chunked.

### Frontend — driver app (Next.js, `client-app/`)

- Recharts kept, but **lazy-loaded**: the earnings bar chart was extracted to
  `EarningsChart.tsx` and imported via `next/dynamic({ ssr: false })`, so recharts is
  code-split out of the earnings route's initial bundle instead of shipping inline.

### Bundle analysis (both Next apps)

- `@next/bundle-analyzer` (devDependency) wired into both `next.config.ts`, gated by
  `enabled: process.env.ANALYZE === "true"` — off for normal builds.
- `"analyze": "cross-env ANALYZE=true next build --webpack"` in both apps. The analyzer
  hooks the **Webpack** build, so the script forces `--webpack` (Next 16 defaults to
  Turbopack, which the plugin can't instrument); the normal `build` script stays on
  Turbopack. `cross-env` (devDependency) sets the env var portably on Windows. Run
  `npm run analyze` to open the report.

---

## Already done / not applicable (no change needed)

- `GET /api/v1/config/flags` and `/api/v1/config/app-version` — already set `Cache-Control`.
- Financial ledger earnings index — `idx_ledger_entries_driver_date` on
  `financial_ledger_entries (driver_id, created_at)` already exists.
- **Driver H3 spatial index — N/A.** There is no `drivers.h3_cell` / `is_online` column;
  driver proximity is served from **Redis sorted sets**, not SQL. The proposed
  `CREATE INDEX ON drivers(h3_cell) WHERE is_online` would fail.
- `GET /api/v1/cms/document` — endpoint does not exist.
- Leaflet already dynamically imported in `rider-app`; `next/font` already uses
  `display: swap` + `subsets: ['latin']` in `client-app`. lucide-react is not used anywhere.

---

## Not done — requires live infrastructure (manual follow-up)

- **`EXPLAIN ANALYZE` on the 5 hot queries** — needs a populated Postgres instance; not
  available in this environment. The two new indexes above target the queries that lacked
  supporting indexes. Validate plans against staging before/after.
- **Lighthouse (target Performance > 85)** — needs the apps running. Capture before/after
  once deployed.
- **Bundle size before/after numbers** — run `npm run analyze` in each Next app and record
  initial-JS gzipped sizes here after this branch builds in CI.

---

## Verification done

- `go build ./cmd/gateway/... ./cmd/dispatch/... ./cmd/ingestion/... ./internal/surge/... ./internal/gateway/...` — passes.
- `client-app` type-check — new/edited files (`earnings/page.tsx`, `EarningsChart.tsx`)
  compile clean. (Pre-existing tsc errors come from uninstalled optional devDeps:
  `@sentry/nextjs`, `@testing-library/*`, `@vitejs/plugin-react` — unrelated to this pass.)
- `@next/bundle-analyzer` wiring — `index.d.ts` uses `export =`; with `esModuleInterop:true`
  (set in both apps) the default import type-checks, and the factory→wrapper chain was
  verified at runtime. `cross-env` binary present in both apps.
- `graphify update .` re-run — graph rebuilt (6128 nodes / 10084 edges) reflecting this pass.
