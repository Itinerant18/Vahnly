package observability

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Gateway-facing Prometheus instruments. Names use the dfu_ prefix (no Namespace)
// so the metric names match exactly what the Grafana dashboards and Alertmanager
// rules query (e.g. dfu_http_requests_total). HTTP metrics are populated by the
// gateway metrics middleware; business gauges by the periodic sampler in
// cmd/gateway; SOS/fare counters at their event sites.
var (
	// HTTPRequestsTotal counts HTTP requests by method, normalized route, and status.
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "dfu_http_requests_total",
		Help: "Total HTTP requests by method, path, status.",
	}, []string{"method", "path", "status"})

	// HTTPRequestDuration tracks request latency in seconds by method and route.
	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "dfu_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds by method and path.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5},
	}, []string{"method", "path"})

	// ActiveTripsGauge is the count of in-progress trips per city (sampled).
	ActiveTripsGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "dfu_active_trips",
		Help: "Active (in-progress) trips by city.",
	}, []string{"city"})

	// OnlineDriversGauge is the count of online drivers per city and transmission (sampled).
	OnlineDriversGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "dfu_online_drivers",
		Help: "Online drivers by city and transmission capability.",
	}, []string{"city", "transmission"})

	// DispatchLatencySeconds measures time from order created to driver assigned.
	DispatchLatencySeconds = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "dfu_dispatch_latency_seconds",
		Help:    "Time from order created to driver assigned, in seconds.",
		Buckets: []float64{1, 2, 5, 10, 15, 30, 60, 120},
	})

	// FareAmountPaise records the distribution of final fares by trip type and city.
	FareAmountPaise = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "dfu_fare_amount_paise",
		Help:    "Fare amount distribution in paise by trip type and city.",
		Buckets: prometheus.ExponentialBuckets(10000, 2, 10),
	}, []string{"trip_type", "city"})

	// SOSAlertsTotal counts SOS alerts raised across drivers and riders.
	SOSAlertsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "dfu_sos_alerts_total",
		Help: "Total SOS alerts raised.",
	})

	// DBPoolConnections is the number of currently-acquired pgx pool connections (sampled).
	DBPoolConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "dfu_db_pool_connections",
		Help: "Currently acquired PostgreSQL pool connections.",
	})

	// DBPoolMaxConnections is the configured pgx pool ceiling (sampled).
	DBPoolMaxConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "dfu_db_pool_max_connections",
		Help: "Maximum PostgreSQL pool connections (pool ceiling).",
	})
)
