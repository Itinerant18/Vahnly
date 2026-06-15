package repository

import "testing"

// TestComputeDiscount covers the pure discount math used by the DB-backed promo
// validator: FLAT vs PERCENT, the max-discount cap, and the floor that prevents a
// discount from ever exceeding the fare. The DB window/limit checks around it need a
// live Postgres and are exercised by the integration suite.
func TestComputeDiscount(t *testing.T) {
	cases := []struct {
		name                     string
		discountType             string
		value, maxDiscount, fare int64
		want                     int64
	}{
		{"flat under fare", "FLAT", 5000, 0, 20000, 5000},
		{"flat clamped to fare", "FLAT", 30000, 0, 20000, 20000},
		{"percent uncapped", "PERCENT", 10, 0, 50000, 5000},        // 10% of 500
		{"percent hits cap", "PERCENT", 10, 10000, 200000, 10000},  // 10% of 2000 = 20000 -> cap
		{"percent under cap", "PERCENT", 10, 10000, 50000, 5000},   // 10% of 500 < cap
		{"percent clamped to fare", "PERCENT", 200, 0, 1000, 1000}, // 200% -> floor at fare
		{"zero percent", "PERCENT", 0, 0, 50000, 0},
		{"unknown type treated as flat", "WEIRD", 4000, 0, 50000, 4000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := computeDiscount(c.discountType, c.value, c.maxDiscount, c.fare); got != c.want {
				t.Errorf("computeDiscount(%q,%d,%d,%d) = %d, want %d",
					c.discountType, c.value, c.maxDiscount, c.fare, got, c.want)
			}
		})
	}
}
