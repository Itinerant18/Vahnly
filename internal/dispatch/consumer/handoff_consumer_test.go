package consumer

import (
	"testing"

	"github.com/platform/driver-delivery/internal/observability"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

// TestLWWShouldApply locks the Last-Write-Wins decision the Lua gate encodes:
// only a strictly-newer claim wins; equal or older claims are rejected so that
// duplicate/out-of-order handoffs are idempotent and two regions cannot both
// claim the same driver.
func TestLWWShouldApply(t *testing.T) {
	cases := []struct {
		name     string
		incoming int64
		stored   int64
		want     bool
	}{
		{"first ever claim (no stored)", 1000, 0, true},
		{"strictly newer claim wins", 2000, 1000, true},
		{"equal timestamp is stale (idempotent retry)", 1000, 1000, false},
		{"older out-of-order claim rejected", 500, 1000, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lwwShouldApply(tc.incoming, tc.stored); got != tc.want {
				t.Errorf("lwwShouldApply(%d, %d) = %v, want %v", tc.incoming, tc.stored, got, tc.want)
			}
		})
	}
}

// TestHandoffMetricsRecord verifies the Milestone 29 instruments are registered
// and accept observations for the migration_latency and handoff-phase signals.
func TestHandoffMetricsRecord(t *testing.T) {
	observability.MigrationLatencySeconds.WithLabelValues("kolkata", "howrah").Observe(0.42)
	observability.RegionHandoffsTotal.WithLabelValues("hydrated", "howrah").Inc()

	if got := testutil.CollectAndCount(observability.MigrationLatencySeconds); got == 0 {
		t.Error("expected migration_latency_seconds to have at least one observed series")
	}
	if got := testutil.ToFloat64(observability.RegionHandoffsTotal.WithLabelValues("hydrated", "howrah")); got < 1 {
		t.Errorf("expected region_handoffs_total{phase=hydrated} >= 1, got %v", got)
	}
}
