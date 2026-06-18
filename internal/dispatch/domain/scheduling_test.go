package domain

import (
	"testing"
	"time"
)

func TestScheduledDispatchLead(t *testing.T) {
	cases := []struct {
		env  string
		want time.Duration
	}{
		{"20", 20 * time.Minute},
		{"60", 60 * time.Minute},
		{"garbage", 40 * time.Minute}, // unparseable → default
		{"0", 40 * time.Minute},       // non-positive → default
		{"-5", 40 * time.Minute},      // negative → default
	}
	for _, c := range cases {
		t.Setenv("SCHEDULED_DISPATCH_LEAD_MINUTES", c.env)
		if got := ScheduledDispatchLead(); got != c.want {
			t.Errorf("env=%q => %v, want %v", c.env, got, c.want)
		}
	}
}
