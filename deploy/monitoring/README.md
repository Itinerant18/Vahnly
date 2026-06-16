# Production Monitoring

Prometheus + Grafana + Alertmanager for the Vahnly platform, plus the Go
metrics they scrape and a synthetic uptime check.

## What's here

| File | Purpose |
|---|---|
| `prometheus-values.yaml` | kube-prometheus-stack Helm values — 15d retention, 20Gi PVC, gateway scrape, node-exporter, kube-state-metrics, Alertmanager routing |
| `grafana-values.yaml` | Grafana values — admin password from a Secret, dashboard sidecar |
| `gateway-servicemonitor.yaml` | Metrics `Service` (port 9090) + `ServiceMonitor` for the gateway |
| `alertmanager-rules.yaml` | `PrometheusRule` — critical (page) + warning (Slack) alerts |
| `dashboards/*.json` | Operations, Business, Infrastructure dashboards |
| `healthchecks.yaml` | Synthetic uptime CronJob (probes `/health` + `/api/v1/fare-estimate`) |

## Backend metrics

The gateway exposes Prometheus metrics on an **internal** port (`METRICS_PORT`,
default `9090`) — separate from the public API port `8080` so a NetworkPolicy can
restrict `/metrics` to the monitoring namespace only (see
`deploy/charts/.../networkpolicies.yaml`, rule 2b). Metric definitions live in
`internal/observability/gateway_metrics.go`.

| Metric | Type | Source |
|---|---|---|
| `dfu_http_requests_total{method,path,status}` | counter | metrics middleware (all routes) |
| `dfu_http_request_duration_seconds{method,path}` | histogram | metrics middleware |
| `dfu_active_trips{city}` | gauge | 30s DB sampler |
| `dfu_online_drivers{city,transmission}` | gauge | 30s DB sampler |
| `dfu_dispatch_latency_seconds` | histogram | dispatch consumer (order.created→assigned) |
| `dfu_fare_amount_paise{trip_type,city}` | histogram | trip-end handler |
| `dfu_sos_alerts_total` | counter | SOS callbacks |
| `dfu_db_pool_connections` / `dfu_db_pool_max_connections` | gauge | 30s pool sampler |

Path labels are normalized (UUIDs / numeric IDs → `{id}`) to bound cardinality.

## Health / probe endpoints

| Endpoint | Port | Semantics |
|---|---|---|
| `/live` | 8080 | Liveness — lenient, process-alive only (k8s livenessProbe) |
| `/ready` | 8080 | Readiness — strict, all deps ok else 503 (k8s readinessProbe) |
| `/health` | 8080 | Rich JSON `{status, services, version, uptime_seconds}`, 503 when degraded |
| `/metrics` | 9090 | Prometheus scrape (internal only) |

Liveness points at `/live` (not `/health`) on purpose: a DB/Redis blip must never
kill an otherwise-healthy pod.

## Install

```bash
# 1. Label the monitoring namespace so the metrics NetworkPolicy admits scrapes.
kubectl create namespace monitoring
kubectl label namespace monitoring name=monitoring

# 2. Grafana admin secret (rule 4 — never in values).
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -base64 24)"

# 3. Alertmanager routing secrets.
kubectl -n monitoring create secret generic alertmanager-pagerduty --from-literal=key=<PD_KEY>
kubectl -n monitoring create secret generic alertmanager-slack --from-literal=webhook=<SLACK_WEBHOOK>

# 4. Install the stack.
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade --install kube-prom-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f deploy/monitoring/prometheus-values.yaml \
  -f deploy/monitoring/grafana-values.yaml

# 5. Alert rules + gateway ServiceMonitor + dashboards.
kubectl -n monitoring apply -f deploy/monitoring/alertmanager-rules.yaml
kubectl -n dfu-production apply -f deploy/monitoring/gateway-servicemonitor.yaml
for d in deploy/monitoring/dashboards/*.json; do
  name="dfu-dash-$(basename "$d" .json)"
  kubectl -n monitoring create configmap "$name" --from-file="$d" \
    --dry-run=client -o yaml \
    | kubectl label --local -f - grafana_dashboard=1 -o yaml \
    | kubectl apply -f -
done

# 6. Synthetic uptime check.
kubectl -n dfu-production apply -f deploy/monitoring/healthchecks.yaml
```

## Alert routing (rule 5)

- **critical** → PagerDuty (immediate page): gateway 5xx > 1%, dispatch p95 > 60s,
  SOS raised, DB pool > 80%, pod CrashLoopBackOff.
- **warning** → Slack `#dfu-alerts`: low driver supply (peak), Kafka lag > 1000,
  Redis memory > 80%, payment failure > 2%.

Kafka-lag and Redis-memory warnings need `kafka-exporter` / `redis-exporter`
deployed; they stay dormant (no series) until then.

## Known gaps / honest notes

- **SOS "unacknowledged > 5m"**: we track SOS as a counter, so the alert fires on
  *any* SOS in the last 5m. True ack-tracking needs an acknowledged-state gauge
  fed from the incident terminal — wire that and switch the rule to it.
- **Payment failure rate**: proxied via 5xx ratio on `*payment*` routes. Replace
  with a dedicated `dfu_payment_failures_total` once payment outcomes are
  instrumented at the gateway.
- **Cancellation rate** (dashboard): proxied via cancel-endpoint request share.
- **Per-service metrics**: only the gateway ships a ServiceMonitor today. Other
  services already serve `/metrics` (via `observability.HealthServer`); add a
  ServiceMonitor per service to scrape them.
- **Uptime CronJob**: k8s CronJob granularity is 1 minute, so the job does two
  passes ~30s apart to approximate the requested 30s cadence. The Kafka failure
  publish needs a Kafka REST proxy (`KAFKA_REST_PROXY_URL`); without it that step
  is skipped.

## Frontend error tracking (Sentry)

Driver + rider apps use `@sentry/nextjs`; admin uses `@sentry/react`. Init is
**no-op without a DSN**, so dev/CI builds are unaffected. Config:

- `client-app/sentry.client.config.ts`, `rider-app/sentry.client.config.ts`
- `*/sentry.server.config.ts` + `instrumentation*.ts` (Next runtime hooks)
- `frontend/src/lib/sentry.ts` (called from `main.tsx`)

PII is stripped in `beforeSend` (email / phone / ip). Session replay masks all
text; 1% of sessions, 100% on error. Error boundaries wrap the driver trip
manager, rider booking + live-trip, and the admin root.

> The old `Sentry.metrics.*` funnel API was **removed in Sentry JS v8**. The
> dispatch funnel is modeled with breadcrumbs + span attributes via
> `trackFunnel()` / `trackEvent()` in `*/lib/telemetry/sentry.ts`.
