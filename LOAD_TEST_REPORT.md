# Load Test Report — Dispatch System

Date: 2026-06-14
Suite: `load-tests/` (k6 v2.0.0)

> **Status: suite built and validated; live run PENDING.**
> All four scripts compile (`k6 inspect` passes) and k6 is installed. No load run has been
> executed yet because the application **gateway is not running** — `k6 run health-probe.js`
> against `http://localhost:8085/health` returned `0` (connection refused). The infra
> (Postgres/Kafka/Redis) is up in the `dispatch` k8s namespace, but the gateway process and
> rider-token provisioning are required before a real run. **No metrics below are
> fabricated** — result cells are left to be filled by an actual run.

---

## Scenarios

| Script | Scenario | Load profile | Pass criteria |
|---|---|---|---|
| `booking-flow.js` | Fare estimate → book → cancel | ramping VUs 0→100→200→0 over ~11 min | fare p95<500ms, book p95<1s, errors<1% |
| `websocket-stress.js` | 500 rider WS connections held 10 min | 500 VUs, 1 long-lived conn each | connect success>99%, unexpected drops<5 |
| `dispatch-rush.js` | 200 drivers online+accepting, 500 bookings/10 min, 50/min peak | arrival-rate riders + per-VU drivers | dispatch p50<8s / p95<25s / p99<60s, unmatched<5% |

## Key metrics (to fill after a run)

### Booking flow
| Metric | p50 | p95 | p99 | Target |
|---|---|---|---|---|
| `fare_estimate` duration | _pending_ | _pending_ | _pending_ | p95 < 500ms |
| `book_driver` duration | _pending_ | _pending_ | _pending_ | p95 < 1000ms |
| `http_req_failed` rate | _pending_ | | | < 1% |

### Dispatch rush
| Metric | Value | Target |
|---|---|---|
| `dispatch_latency_ms` p50 / p95 / p99 | _pending_ | 8s / 25s / 60s |
| `unmatched_rate` | _pending_ | < 5% |
| `offers_accepted`, `bookings_created` | _pending_ | — |

### Backend-only (read from Grafana/Prometheus during the run — k6 cannot see these)
| Metric | Source | Value |
|---|---|---|
| Redis H3 cache hit rate | Redis / app metrics | _pending_ |
| PostgreSQL QPS under load | `pg_stat_statements` | _pending_ |
| Driver utilization | offers accepted ÷ drivers online | _pending_ |
| Backend dispatch latency | `dfu_dispatch_latency_seconds` histogram | _pending_ |
| Kafka consumer lag | Kafka / Grafana | _pending_ |

## Bottlenecks found
_Pending live run._ Watch list for analysis (EXECUTION RULE 4): any endpoint whose p95
breaches its threshold → capture `EXPLAIN ANALYZE` for its query and confirm the relevant
index is used. Prime suspects given the schema:
- `book_driver` / order create → fare path + insert into `orders`.
- `poll_active` (rider order status) → should hit `idx_orders_rider_created` (migration 000101).
- Admin/list paths under concurrent load → `idx_orders_status_city_created` (migration 000102).

## Changes made to fix bottlenecks
_Pending live run._ (The order-query indexes in `PERFORMANCE.md` were added in the prior
performance pass; confirm they are present and used under load before adding more.)

## Re-test results after fixes
_Pending._

---

## What was built and verified (this pass)

- Installed **k6 v2.0.0** (`winget GrafanaLabs.k6`).
- Authored 4 grounded scripts + shared `config.js` / `lib/auth.js`, all **compiling clean**
  under `k6 inspect` (incl. `k6/ws`, which this k6 still supports).
- Corrected the template against the **real** API:
  - Endpoints exist as: `POST /api/v1/rider/fare-estimate` (200),
    `POST /api/v1/rider/orders` (201), status via `GET /api/v1/rider/orders/active`,
    cancel via `DELETE /api/v1/rider/orders/{id}/cancel`.
  - WS is `GET /ws/rider?ticket=…` after `POST /api/v1/ws/ticket` — **not** `/ws/rider?ticket`
    with a raw JWT; tickets are single-use, 30s TTL.
  - Pickups constrained to the seeded Kolkata geofence (lat 22.45–22.65, lng 88.25–88.45).
  - Bookings use `one_time_car` (no seeded garage car needed).

## Blockers before a real run (honest)

1. **Gateway not running** — start it (with the k8s port-forwards from `run_e2e_test.ps1`)
   and confirm via `health-probe.js`.
2. **Rider tokens** — riders use OTP with no bypass; provision a pool out of band
   (`load-tests/provision/provision-rider-tokens.md`) and pass `-e RIDER_TOKENS_FILE`.
   Drivers self-bootstrap (register + login), no provisioning needed.
3. **Driver offer acceptance is built in** — `dispatch-rush.js` drivers poll
   `GET /api/v1/driver/offer` and `PATCH …/offer-response {response:"ACCEPTED"}`, so orders
   actually reach `ASSIGNED` and dispatch latency is measurable. Without this, latency is
   undefined (orders would sit in `CREATED`).
4. **InfluxDB sink** — `--out influxdb` was dropped from k6 core; use `--out json=` or
   Prometheus remote-write. README reflects this.
