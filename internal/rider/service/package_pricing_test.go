package service

import "testing"

func TestPackageFarePaise(t *testing.T) {
	cases := []struct {
		name     string
		pkg      string
		hours    int
		want     int64
		wantOK   bool
	}{
		// HOURLY: ₹150/hr, min 2h.
		{"hourly above min", "HOURLY", 3, 45000, true},
		{"hourly below min clamps to 2h", "HOURLY", 1, 30000, true},
		{"hourly lowercase", "hourly", 2, 30000, true},
		// MINI_OUTSTATION: ₹140/hr, min 4h.
		{"mini below min clamps to 4h", "MINI_OUTSTATION", 2, 56000, true},
		{"mini above min", "MINI_OUTSTATION", 6, 84000, true},
		// OUTSTATION: ₹1500/day (12h/day) + ₹300/night halt. 1 day, 0 nights.
		{"outstation single day", "OUTSTATION", 8, 150000, true},
		// 2 days (13h -> ceil 2), 1 night halt: 2*1500 + 1*300.
		{"outstation two days one night", "OUTSTATION", 13, 330000, true},
		// MONTHLY flat.
		{"monthly flat", "MONTHLY", 0, 2000000, true},
		// Unknown / empty -> not a package.
		{"empty falls through", "", 5, 0, false},
		{"unknown falls through", "WEEKLY", 5, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := packageFarePaise(c.pkg, c.hours)
			if ok != c.wantOK || got != c.want {
				t.Errorf("packageFarePaise(%q, %d) = (%d, %v), want (%d, %v)", c.pkg, c.hours, got, ok, c.want, c.wantOK)
			}
		})
	}
}
