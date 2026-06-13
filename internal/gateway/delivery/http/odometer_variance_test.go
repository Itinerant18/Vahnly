package http

import "testing"

// TestOdometerVariancePct reproduces the brief's worked example end-to-end:
// straight-line 70km × road-factor 1.3 = 91km expected.
func TestOdometerVariancePct(t *testing.T) {
	// Reported 100km → (100-91)/91 = +9.89% → within the 15% band, NOT flagged.
	v := odometerVariancePct(100, 70)
	if v < 9.8 || v > 10.0 {
		t.Fatalf("expected ~9.9%% variance, got %.2f%%", v)
	}
	if odometerFlagged(v) {
		t.Errorf("9.9%% variance is within tolerance and must NOT be flagged")
	}

	// Reported 120km → (120-91)/91 = +31.87% → breaches tolerance → FLAGGED.
	v2 := odometerVariancePct(120, 70)
	if v2 < 31.0 || v2 > 32.0 {
		t.Fatalf("expected ~31.9%% variance, got %.2f%%", v2)
	}
	if !odometerFlagged(v2) {
		t.Errorf("31.9%% variance breaches tolerance and must be flagged")
	}
}

// TestOdometerFlagged_Boundary pins the inclusive tolerance edge and the absolute-value
// handling (under-reporting is flagged too).
func TestOdometerFlagged_Boundary(t *testing.T) {
	if odometerFlagged(odoTolerancePctGW) {
		t.Errorf("exactly %.0f%% is within tolerance (inclusive) and must not flag", odoTolerancePctGW)
	}
	if !odometerFlagged(odoTolerancePctGW + 0.01) {
		t.Errorf("just over tolerance must flag")
	}
	if !odometerFlagged(-20.0) {
		t.Errorf("a -20%% under-report breaches tolerance on |variance| and must flag")
	}
}

// TestOdometerVariancePct_ZeroExpected guards the divide-by-zero path: a degenerate
// pickup==dropoff order (straight-line 0) yields 0 variance, not NaN/Inf.
func TestOdometerVariancePct_ZeroExpected(t *testing.T) {
	if v := odometerVariancePct(50, 0); v != 0 {
		t.Errorf("zero straight-line distance must yield 0 variance, got %.2f", v)
	}
}
