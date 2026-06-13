# Drivers-for-u — Load Test Suite (k6)

Grounded k6 load tests for the dispatch platform. Every endpoint, payload, auth flow and
enum here was verified against the real backend (route registration in `cmd/gateway/main.go`
and the rider/driver service structs), not assumed.

## Scripts

| Script | Task | What it does |
|---|---|---|
| `health-probe.js` | — | Reachability smoke. Run first. |
| `booking-flow.js` | 2 | Fare estimate → book driver, ramping 0→peak. |
| `websocket-stress.js` | 3 | 500 rider WS connections held 10 min; stability + frame counts. |
| `dispatch-rush.js` | 4 | Kolkata rush: 200 drivers online + accepting offers, 500 bookings/10 min, measures order→ASSIGNED latency. |

## Prerequisites

1. **k6** — installed (`winget install GrafanaLabs.k6`). Verify: `k6 version`.
2. **A running gateway** reachable at `BASE_URL` (default `http://localhost:8085`).
   The infra (Postgres/Kafka/Redis) runs in the `dispatch` k8s namespace; the gateway
   itself runs as a local process. Bring up port-forwards + the gateway before testing
   (see `run_e2e_test.ps1` for the port-forward setup). Confirm with:
   ```
   k6 run -e BASE_URL=http://localhost:8085 load-tests/health-probe.js
   ```
   A `health -> 0` means the gateway is not up.
3. **Rider tokens** (`booking-flow.js`, `websocket-stress.js`, rider half of `dispatch-rush.js`).
   Riders authenticate via OTP with **no test bypass**, so rider JWTs cannot be obtained from
   inside k6. Pre-provision a pool and pass it in — see
   [`provision/provision-rider-tokens.md`](provision/provision-rider-tokens.md). Drivers are
   bootstrapped automatically (register + password login) and need no provisioning.

## Running

```bash
# Task 2 — booking flow (scale down with -e MAX_VUS=50 on limited infra)
k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json \
       load-tests/booking-flow.js --out json=results-booking.json

# Task 3 — WebSocket stress (run alongside dispatch-rush to get real message delivery)
k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json \
       -e WS_CONNS=500 -e WS_HOLD_SECONDS=600 load-tests/websocket-stress.js

# Task 4 — Kolkata dispatch rush
k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json \
       -e DRIVERS=200 load-tests/dispatch-rush.js --out json=results-rush.json
```

InfluxDB output (`--out influxdb=...`) was removed from k6 core; use `--out json=` (above)
or k6 Cloud / Prometheus remote-write if you need a time-series sink.

## Tunable env vars

| Var | Default | Script(s) |
|---|---|---|
| `BASE_URL` | `http://localhost:8085` | all |
| `RIDER_TOKENS_FILE` | — (required) | booking, ws, rush |
| `MAX_VUS` | 200 | booking-flow |
| `WS_CONNS` / `WS_HOLD_SECONDS` | 500 / 600 | websocket-stress |
| `DRIVERS` | 200 | dispatch-rush |
| `RIDER_RATE_PEAK` | 50 | dispatch-rush |
| `ASSIGN_TIMEOUT_MS` | 60000 | dispatch-rush |

## Execution rules (from the brief)

- **Staging only, never production.** The default `localhost:8085` targets local dev.
- **Scale down to 50 VUs** if infra is limited (`-e MAX_VUS=50` / `-e DRIVERS=50`).
- **Watch Grafana during the run** for CPU, Redis latency, Kafka consumer lag. The metrics
  k6 cannot see — Redis H3 cache-hit rate, PostgreSQL QPS, driver utilization, and the
  backend `dfu_dispatch_latency_seconds` histogram — must be read there.
- If p95 exceeds a threshold, find the slow endpoint and fix before go-live. The composite
  order indexes added in `PERFORMANCE.md` (migrations 000101/000102) are the first thing to
  confirm are present under load.
```
