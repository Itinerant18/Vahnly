package domain

import (
	"os"
	"strconv"
	"time"
)

// ScheduledDispatchLead is how far before a scheduled pickup a future-dated order enters
// the matcher. Both the booking-time defer decision and the dispatch scheduler sweeper
// read this single source, so they always agree on the cutover. Configurable via
// SCHEDULED_DISPATCH_LEAD_MINUTES (default 40 minutes — enough first-mile lead for the
// driver to reach the rider's car).
func ScheduledDispatchLead() time.Duration {
	if v := os.Getenv("SCHEDULED_DISPATCH_LEAD_MINUTES"); v != "" {
		if m, err := strconv.Atoi(v); err == nil && m > 0 {
			return time.Duration(m) * time.Minute
		}
	}
	return 40 * time.Minute
}
