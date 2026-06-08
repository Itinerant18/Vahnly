package observability

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// DispatchMetrics holds all Prometheus metric instruments for the dispatch pipeline.
var (
	OrdersMatchedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dispatch",
		Name:      "orders_matched_total",
		Help:      "Total number of orders successfully assigned to drivers.",
	}, []string{"algorithm", "city"})

	OrdersUnmatchedTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dispatch",
		Name:      "orders_unmatched_total",
		Help:      "Total number of orders that could not be assigned.",
	}, []string{"reason"})

	BatchDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "dispatch",
		Name:      "batch_duration_seconds",
		Help:      "Time spent processing a full matching batch.",
		Buckets:   []float64{0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 2.0, 5.0},
	}, []string{"algorithm"})

	CostMatrixDimension = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "dispatch",
		Name:      "cost_matrix_dimension",
		Help:      "The N dimension of the NxN cost matrix sent to the Hungarian solver.",
		Buckets:   []float64{1, 2, 5, 10, 25, 50, 100, 150},
	})

	TritonRPCDurationSeconds = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "dispatch",
		Name:      "triton_rpc_duration_seconds",
		Help:      "Time spent in a single Triton ModelInfer gRPC call.",
		Buckets:   []float64{0.001, 0.005, 0.01, 0.015, 0.025, 0.05, 0.1},
	})

	KafkaEmitErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dispatch",
		Name:      "kafka_emit_errors_total",
		Help:      "Total number of failed downstream Kafka event emissions.",
	}, []string{"topic"})

	DBTransactionDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "dispatch",
		Name:      "db_transaction_duration_seconds",
		Help:      "Time spent in a PostgreSQL assignment transaction.",
		Buckets:   []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0},
	}, []string{"result"})

	CircuitBreakerStateGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "dispatch",
		Name:      "circuit_breaker_state",
		Help:      "Current circuit breaker state: 0=closed, 1=half-open, 2=open.",
	}, []string{"name"})

	BatchSizeHistogram = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "dispatch",
		Name:      "batch_size",
		Help:      "Number of orders in each matching batch.",
		Buckets:   []float64{1, 2, 5, 10, 25, 50, 100, 150},
	})

	// MigrationLatencySeconds tracks the wall-clock time from a driver crossing a
	// region boundary (the CrossedAt stamp on the handoff event) to the destination
	// shard hydrating that driver's state into its local spatial index.
	MigrationLatencySeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "dispatch",
		Name:      "migration_latency_seconds",
		Help:      "Time from a cross-region boundary crossing to destination-shard state hydration.",
		Buckets:   []float64{0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0},
	}, []string{"origin_region", "target_region"})

	// RegionHandoffsTotal counts cross-region handoff events by lifecycle phase:
	// "published" (source emitted INIT), "hydrated" (destination committed), and
	// "rejected_stale" (Last-Write-Wins discarded an out-of-order/duplicate claim).
	RegionHandoffsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dispatch",
		Name:      "region_handoffs_total",
		Help:      "Cross-region driver handoff events by phase and target region.",
	}, []string{"phase", "target_region"})
)
