package observability

import (
	"context"
	"fmt"
	"time"

	"github.com/sony/gobreaker/v2"
)

// TritonCircuitBreaker wraps Triton gRPC calls with automatic failure detection.
// When Triton fails 5 times in 30 seconds, the breaker opens and callers
// immediately get an error so the cost function can fall back to distance-based ETA.
var TritonCircuitBreaker *gobreaker.CircuitBreaker[float64]

func init() {
	TritonCircuitBreaker = gobreaker.NewCircuitBreaker[float64](gobreaker.Settings{
		Name:        "triton-inference",
		MaxRequests: 2,                // Half-open allows 2 probes before closing
		Interval:    30 * time.Second, // Rolling window for failure counting
		Timeout:     10 * time.Second, // How long to stay open before half-open
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
		OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
			fmt.Printf("[CIRCUIT_BREAKER] %s: %s → %s\n", name, from.String(), to.String())
			stateVal := float64(0)
			switch to {
			case gobreaker.StateHalfOpen:
				stateVal = 1
			case gobreaker.StateOpen:
				stateVal = 2
			}
			CircuitBreakerStateGauge.WithLabelValues(name).Set(stateVal)
		},
	})
}

// ExecuteWithBreaker wraps a Triton inference call behind the circuit breaker.
func ExecuteWithBreaker(ctx context.Context, fn func(ctx context.Context) (float64, error)) (float64, error) {
	return TritonCircuitBreaker.Execute(func() (float64, error) {
		return fn(ctx)
	})
}
