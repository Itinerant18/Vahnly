package service

import (
	"testing"
	"time"
)

// daytime IST — no night surcharge — for deterministic block-rate assertions.
var dayIST = time.Date(2026, 1, 15, 12, 0, 0, 0, istZone)

func TestPackageQuote_Blocks(t *testing.T) {
	cases := []struct {
		name     string
		tier     string
		hours    int
		wantBase int64
		wantIncl int
	}{
		{"hatchback 6h block", "HATCHBACK", 6, 65000, 6},
		{"hatchback 8h block", "HATCHBACK", 8, 80000, 8},
		{"hatchback >8h still 8h block (overtime billed trip-end)", "HATCHBACK", 10, 80000, 8},
		{"sedan 6h", "SEDAN", 6, 85000, 6},
		{"suv ≤6h → 6h block", "SUV", 5, 105000, 6},
		{"premium 7h → 8h block", "PREMIUM", 7, 160000, 8},
		{"unknown tier defaults to hatchback", "", 6, 65000, 6},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			q, ok := packageQuote("HOURLY", c.tier, c.hours, 0, dayIST)
			if !ok {
				t.Fatalf("expected ok")
			}
			if q.BasePaise != c.wantBase || q.IncludedHours != c.wantIncl {
				t.Errorf("base=%d incl=%d, want base=%d incl=%d", q.BasePaise, q.IncludedHours, c.wantBase, c.wantIncl)
			}
			if q.NightChargePaise != 0 {
				t.Errorf("noon night=%d, want 0", q.NightChargePaise)
			}
			if q.ServiceFarePaise() != c.wantBase {
				t.Errorf("service=%d, want %d", q.ServiceFarePaise(), c.wantBase)
			}
		})
	}
}

func TestPackageQuote_NightTiers(t *testing.T) {
	cases := []struct {
		hour int
		want int64
	}{
		{14, 0}, {21, 0}, {22, 5000}, {23, 5000}, {0, 10000}, {5, 10000}, {6, 0},
	}
	for _, c := range cases {
		when := time.Date(2026, 1, 15, c.hour, 0, 0, 0, istZone)
		q, _ := packageQuote("HOURLY", "HATCHBACK", 6, 0, when)
		if q.NightChargePaise != c.want {
			t.Errorf("IST hour %d: night=%d, want %d", c.hour, q.NightChargePaise, c.want)
		}
	}
}

func TestPackageQuote_Outstation(t *testing.T) {
	// Sedan, 8h → 1 day, 0 nights, no distance.
	q, ok := packageQuote("OUTSTATION", "SEDAN", 8, 0, dayIST)
	if !ok || q.BasePaise != 320000 || q.Days != 1 || q.NightsAway != 0 ||
		q.DriverAllowancePaise != 0 || q.NightChargePaise != 0 {
		t.Fatalf("single-day: %+v", q)
	}
	// Sedan, 13h → 2 days, 1 night: base 2×3200, allowance ₹600, night ₹100.
	q2, _ := packageQuote("OUTSTATION", "SEDAN", 13, 0, dayIST)
	if q2.BasePaise != 640000 || q2.Days != 2 || q2.NightsAway != 1 ||
		q2.DriverAllowancePaise != 60000 || q2.NightChargePaise != 10000 {
		t.Errorf("two-day: %+v", q2)
	}
	// Premium night allowance is ₹700.
	q3, _ := packageQuote("OUTSTATION", "PREMIUM", 13, 0, dayIST)
	if q3.DriverAllowancePaise != 70000 {
		t.Errorf("premium allowance=%d, want 70000", q3.DriverAllowancePaise)
	}
	// Extra-km: 1 day, one-way 400 km → 100 km over 300 → 100×₹12 = ₹1200 (Sedan).
	q4, _ := packageQuote("OUTSTATION", "SEDAN", 8, 400, dayIST)
	if q4.ExtraKmPaise != 120000 || q4.ServiceFarePaise() != 320000+120000 {
		t.Errorf("extra-km: %+v service=%d", q4, q4.ServiceFarePaise())
	}
	// MINI_OUTSTATION is retired → priced via the outstation card.
	q5, _ := packageQuote("MINI_OUTSTATION", "SEDAN", 8, 0, dayIST)
	if q5.BasePaise != 320000 {
		t.Errorf("mini→outstation base=%d, want 320000", q5.BasePaise)
	}
}

func TestPackageQuote_MonthlyAndFallthrough(t *testing.T) {
	q, ok := packageQuote("MONTHLY", "HATCHBACK", 0, 0, dayIST)
	if !ok || q.BasePaise != 2000000 {
		t.Errorf("monthly: %+v ok=%v", q, ok)
	}
	for _, pt := range []string{"", "WEEKLY", "garbage"} {
		if _, ok := packageQuote(pt, "SEDAN", 5, 0, dayIST); ok {
			t.Errorf("%q should fall through to distance pricing", pt)
		}
	}
	// isPackageBooking agrees with the quote function on what is a package.
	for _, pt := range []string{"HOURLY", "OUTSTATION", "MINI_OUTSTATION", "MONTHLY"} {
		if !isPackageBooking(pt) {
			t.Errorf("isPackageBooking(%q) = false, want true", pt)
		}
	}
	if isPackageBooking("WEEKLY") {
		t.Errorf("isPackageBooking(WEEKLY) = true, want false")
	}
}
