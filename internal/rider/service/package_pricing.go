package service

import (
	"os"
	"strconv"
	"strings"
)

// Package (duration-based) pricing — B4. The rider books a driver for a block of time or a
// trip package rather than a metered point-to-point ride, so the fare comes from a flat rate
// card, NOT distance, and NO surge applies ("no surge pricing" is the headline differentiator).
//
// Rates here are PLACEHOLDERS modelled on the drivers4me tiers. Every knob is env-overridable
// (PKG_*); move to a rate_card table when ops needs to tune per-city without a redeploy.
const (
	PackageHourly        = "HOURLY"
	PackageMiniOutstation = "MINI_OUTSTATION"
	PackageOutstation    = "OUTSTATION"
	PackageMonthly       = "MONTHLY"
)

// packageFarePaise returns the rate-card fare for a package booking and true, or (0, false)
// when packageType is empty/unknown (caller then falls back to distance pricing).
func packageFarePaise(packageType string, durationHours int) (int64, bool) {
	switch strings.ToUpper(strings.TrimSpace(packageType)) {
	case PackageHourly:
		perHour := envPaise("PKG_HOURLY_PER_HOUR_PAISE", 15000) // ₹150/hr
		minH := envInt("PKG_HOURLY_MIN_HOURS", 2)
		return perHour * int64(max(durationHours, minH)), true

	case PackageMiniOutstation:
		perHour := envPaise("PKG_MINI_PER_HOUR_PAISE", 14000) // ₹140/hr
		minH := envInt("PKG_MINI_MIN_HOURS", 4)
		return perHour * int64(max(durationHours, minH)), true

	case PackageOutstation:
		perDay := envPaise("PKG_OUTSTATION_PER_DAY_PAISE", 150000)   // ₹1500/day
		nightHalt := envPaise("PKG_OUTSTATION_NIGHT_HALT_PAISE", 30000) // ₹300/night driver allowance
		hoursPerDay := envInt("PKG_OUTSTATION_HOURS_PER_DAY", 12)
		days := (max(durationHours, 1) + hoursPerDay - 1) / hoursPerDay // ceil
		if days < 1 {
			days = 1
		}
		return perDay*int64(days) + nightHalt*int64(days-1), true

	case PackageMonthly:
		return envPaise("PKG_MONTHLY_PER_MONTH_PAISE", 2000000), true // ₹20,000/mo

	default:
		return 0, false
	}
}

// isPackageBooking reports whether a request selects a package tier (vs distance pricing).
func isPackageBooking(packageType string) bool {
	_, ok := packageFarePaise(packageType, 1)
	return ok
}

func envPaise(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}
