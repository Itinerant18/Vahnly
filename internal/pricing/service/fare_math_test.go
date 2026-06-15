package service

import "testing"

// TestComputeFarePaise exercises the pure fare formula directly — no Redis required.
// The surge-cache integration paths (CalculateFare/GetFareQuote) are covered separately
// by the Redis-gated tests; this locks the money math itself.
func TestComputeFarePaise(t *testing.T) {
	cases := []struct {
		name           string
		base, perMeter int64
		distanceMeters float64
		multiplier     float64
		want           int64
	}{
		{"base only, no surge", 4000, 15, 0, 1.0, 4000},
		{"base + 1km, no surge", 4000, 15, 1000, 1.0, 19000},   // 4000 + 15*1000
		{"base + 1km, 1.5x surge", 4000, 15, 1000, 1.5, 28500}, // 19000 * 1.5
		{"base only, 2.5x surge", 10000, 15, 0, 2.5, 25000},
		{"rounds to nearest paise", 4000, 15, 333, 1.333, 11990}, // 8995 * 1.333 = 11990.335
		{"zero multiplier yields zero", 4000, 15, 1000, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := computeFarePaise(c.base, c.perMeter, c.distanceMeters, c.multiplier); got != c.want {
				t.Errorf("computeFarePaise(%d,%d,%.0f,%.3f) = %d, want %d",
					c.base, c.perMeter, c.distanceMeters, c.multiplier, got, c.want)
			}
		})
	}
}

// TestComputeFarePaise_MonotonicInSurge guards the invariant that a higher surge
// multiplier never lowers the fare.
func TestComputeFarePaise_MonotonicInSurge(t *testing.T) {
	prev := int64(-1)
	for _, mult := range []float64{1.0, 1.25, 1.5, 2.0, 3.5} {
		got := computeFarePaise(4000, 15, 5000, mult)
		if got < prev {
			t.Fatalf("fare decreased as surge rose: mult=%.2f gave %d < %d", mult, got, prev)
		}
		prev = got
	}
}
