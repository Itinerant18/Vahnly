package http

import "testing"

// TestTakeRatePctForCompletedTrips locks the tiered-commission boundaries (0-15: 20%,
// 16-50: 15%, 51+: 12%). This is a critical money path: the wrong tier silently
// over/under-pays every driver.
func TestTakeRatePctForCompletedTrips(t *testing.T) {
	cases := []struct {
		completed int64
		want      int64
	}{
		{0, 20}, {1, 20}, {15, 20}, // tier 1 — inclusive upper bound
		{16, 15}, {30, 15}, {50, 15}, // tier 2 — both bounds
		{51, 12}, {100, 12}, {100000, 12}, // tier 3
	}
	for _, c := range cases {
		if got := takeRatePctForCompletedTrips(c.completed); got != c.want {
			t.Errorf("completed=%d: want take-rate %d%%, got %d%%", c.completed, c.want, got)
		}
	}
}

// TestDriverLedgerSplit_BalancesDoubleEntry is the single most important financial
// invariant: the driver credit + platform-commission credit must exactly equal the
// rider debit (total fare). If this ever fails, the double-entry ledger is unbalanced.
func TestDriverLedgerSplit_BalancesDoubleEntry(t *testing.T) {
	cases := []struct {
		name                    string
		nonToll, tolls, parking int64
		rate                    int64
	}{
		{"fare only, 20%", 100000, 0, 0, 20},
		{"fare + tolls + parking, 15%", 100000, 5000, 3000, 15},
		{"fare + tolls, 12%", 50000, 12000, 0, 12},
		{"sub-paise commission remainder", 1, 0, 0, 20}, // 1*20/100 = 0 (floored)
		{"zero fare", 0, 0, 0, 20},
		{"pure tolls/parking, no fare", 0, 8000, 2000, 20},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			earn, comm := driverLedgerSplit(c.nonToll, c.tolls, c.parking, c.rate)
			total := c.nonToll + c.tolls + c.parking
			if earn+comm != total {
				t.Errorf("double-entry imbalance: driver(%d) + commission(%d) = %d, want total %d",
					earn, comm, earn+comm, total)
			}
			if wantComm := c.nonToll * c.rate / 100; comm != wantComm {
				t.Errorf("commission = %d, want %d (%d%% of non-toll %d)", comm, wantComm, c.rate, c.nonToll)
			}
		})
	}
}

// TestDriverLedgerSplit_TollsPassThrough verifies tolls + parking are reimbursed to the
// driver in full and never attract commission.
func TestDriverLedgerSplit_TollsPassThrough(t *testing.T) {
	earn, comm := driverLedgerSplit(0, 8000, 2000, 20)
	if comm != 0 {
		t.Errorf("commission must be 0 when there is no fare, got %d", comm)
	}
	if earn != 10000 {
		t.Errorf("driver must receive full toll(8000)+parking(2000)=10000, got %d", earn)
	}
}
