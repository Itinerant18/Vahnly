package service

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Package/block (duration-based) pricing — a tiered flat rate card. The rider books a block of
// time (in-city) or a per-day outstation engagement rather than a metered point-to-point ride, so
// the fare comes from a per-(vehicle-tier) rate card, NOT distance, and is NEVER surged ("no surge
// pricing" is the headline differentiator). See DOC/PRICING_PLAN.md.
//
// ponytail: the rate card lives as Go maps here — the booking engine's source of truth and the
// code-level default. Promote to the Redis admin pricing config / a rate_card table when ops needs
// per-city tuning without a redeploy (plan Phase 2). Until then a Redis flush can't zero fares.
const (
	PackageHourly         = "HOURLY"          // In-City Block (6h/60km or 8h/80km, km-capped)
	PackageMiniOutstation = "MINI_OUTSTATION" // retired — priced as single-day OUTSTATION (enum kept for old rows)
	PackageOutstation     = "OUTSTATION"      // per-day, 300 km/day included
	PackageMonthly        = "MONTHLY"
)

// Vehicle tiers (mirror rider-app CarType / admin carTypes).
const (
	tierHatchback = "HATCHBACK"
	tierSedan     = "SEDAN"
	tierSUV       = "SUV"
	tierPremium   = "PREMIUM"
)

// normalizeTier maps a free-form car type to a known tier, defaulting to HATCHBACK.
func normalizeTier(carType string) string {
	switch strings.ToUpper(strings.TrimSpace(carType)) {
	case tierSedan:
		return tierSedan
	case tierSUV:
		return tierSUV
	case tierPremium:
		return tierPremium
	default:
		return tierHatchback
	}
}

// In-City Block rate card (paise). six/eight = the 6h/60km and 8h/80km block fares.
type blockRate struct {
	six, eight      int64
	extraKmPaise    int64 // per km beyond the block's included km — billed at trip-end
	overtimePerHour int64 // per hour beyond the block hours — billed at trip-end
}

var inCityBlockCard = map[string]blockRate{
	tierHatchback: {six: 65000, eight: 80000, extraKmPaise: 1100, overtimePerHour: 5000},
	tierSedan:     {six: 85000, eight: 105000, extraKmPaise: 1300, overtimePerHour: 6000},
	tierSUV:       {six: 105000, eight: 130000, extraKmPaise: 1500, overtimePerHour: 8000},
	tierPremium:   {six: 130000, eight: 160000, extraKmPaise: 1800, overtimePerHour: 10000},
}

// Outstation rate card (paise). perDay includes 300 km/day.
type outstationRate struct {
	perDay         int64
	extraKmPaise   int64 // per km beyond 300×days
	nightAllowance int64 // cash food+lodging per full night away — driver reimbursement passthrough
	nightSurcharge int64 // per night away
}

var outstationCard = map[string]outstationRate{
	tierHatchback: {perDay: 280000, extraKmPaise: 1000, nightAllowance: 60000, nightSurcharge: 10000},
	tierSedan:     {perDay: 320000, extraKmPaise: 1200, nightAllowance: 60000, nightSurcharge: 10000},
	tierSUV:       {perDay: 400000, extraKmPaise: 1400, nightAllowance: 60000, nightSurcharge: 10000},
	tierPremium:   {perDay: 480000, extraKmPaise: 1600, nightAllowance: 70000, nightSurcharge: 10000},
}

var monthlyCard = map[string]int64{
	tierHatchback: 2000000, tierSedan: 2200000, tierSUV: 2600000, tierPremium: 3000000,
}

// In-city point-to-point metered rate card (paise): [base, per-km]. Surge is applied on top by the
// booking engine; these are the pre-surge tier rates.
var meteredCard = map[string][2]int64{
	tierHatchback: {4000, 1100},  // ₹40 + ₹11/km
	tierSedan:     {5000, 1300},  // ₹50 + ₹13/km
	tierSUV:       {6000, 1500},  // ₹60 + ₹15/km
	tierPremium:   {8000, 1800},  // ₹80 + ₹18/km
}

// meteredRateFor returns the pre-surge base (paise) and per-km (paise/km) for a point-to-point trip,
// defaulting unknown tiers to HATCHBACK.
func meteredRateFor(carType string) (basePaise, perKmPaise int64) {
	r := meteredCard[normalizeTier(carType)]
	return r[0], r[1]
}

const (
	blockSixHours         = 6
	blockEightHours       = 8
	outstationHoursPerDay = 12
	outstationKmPerDay    = 300
)

// PackageQuote decomposes a package/block fare. All money in paise.
//   - BasePaise is the commissionable service fare (block fare, or day-rate × days).
//   - NightChargePaise and DriverAllowancePaise are rider-total add-ons. DriverAllowancePaise is a
//     driver reimbursement passthrough (food + lodging) and is intentionally NOT in the
//     commissionable basis.
//   - ExtraKmPaise / OvertimePaise are ZERO at estimate time (no actual km/hours until trip-end);
//     the per-tier rates are carried on the card for trip-end reconciliation (deferred bill flow).
type PackageQuote struct {
	BasePaise            int64
	NightChargePaise     int64
	DriverAllowancePaise int64
	ExtraKmPaise         int64
	OvertimePaise        int64
	Days                 int
	NightsAway           int
	IncludedHours        int
}

// ServiceFarePaise is the commissionable basis sent to dispatch/payout. Excludes the night
// surcharge and the allowance reimbursement — matching the metered path, which dispatches
// base+distance only.
func (q PackageQuote) ServiceFarePaise() int64 {
	return q.BasePaise + q.ExtraKmPaise + q.OvertimePaise
}

// RiderAddonsPaise are the non-service charges added to the rider total here (night + allowance).
func (q PackageQuote) RiderAddonsPaise() int64 {
	return q.NightChargePaise + q.DriverAllowancePaise
}

// nightSurchargePaise is the tiered IST night surcharge (one-time, higher bracket replaces lower):
// ₹50 for 22:00–23:59, ₹100 for 00:00–05:59, ₹0 otherwise.
func nightSurchargePaise(when time.Time) int64 {
	h := when.In(istZone).Hour()
	switch {
	case h < 6:
		return 10000
	case h >= 22:
		return 5000
	default:
		return 0
	}
}

// packageQuote prices a package/block booking. Returns (quote, true) for a known package type, or
// (zero, false) to fall through to distance pricing. distanceKm is the estimated one-way road
// distance (0 if unknown) used for outstation extra-km math; when drives the night surcharge.
func packageQuote(packageType, carType string, durationHours int, distanceKm float64, when time.Time) (PackageQuote, bool) {
	tier := normalizeTier(carType)
	switch strings.ToUpper(strings.TrimSpace(packageType)) {

	case PackageHourly:
		card := inCityBlockCard[tier]
		// Block selection from duration: ≤6h → 6h/60km block, else → 8h/80km block.
		// ponytail: derived from durationHours since the request carries no explicit block field;
		// let the rider pick 6h vs 8h directly once the booking UI exposes it.
		base, incl := card.six, blockSixHours
		if durationHours > blockSixHours {
			base, incl = card.eight, blockEightHours
		}
		return PackageQuote{
			BasePaise:        base,
			NightChargePaise: nightSurchargePaise(when),
			IncludedHours:    incl,
		}, true

	case PackageOutstation, PackageMiniOutstation:
		card := outstationCard[tier]
		// Hybrid day-count: the greater of booked-hours/12 and one-way-distance/300 — a long route
		// can't be underbooked on hours, and an unknown distance (0) falls back to hours.
		hoursDays := (max(durationHours, 1) + outstationHoursPerDay - 1) / outstationHoursPerDay // ceil
		kmDays := 0
		if distanceKm > 0 {
			kmDays = (int(distanceKm) + outstationKmPerDay - 1) / outstationKmPerDay // ceil
		}
		days := max(hoursDays, kmDays)
		if days < 1 {
			days = 1
		}
		nights := days - 1
		// Extra km beyond the per-day allowance (300×days). With the hybrid day-count, days already
		// covers the one-way route, so this is ~0 at estimate; it surfaces at trip-end on actual km.
		extraKm := int64(0)
		if distanceKm > 0 {
			over := distanceKm - float64(outstationKmPerDay*days)
			if over > 0 {
				extraKm = int64(over) * card.extraKmPaise
			}
		}
		return PackageQuote{
			BasePaise:            card.perDay * int64(days),
			ExtraKmPaise:         extraKm,
			DriverAllowancePaise: card.nightAllowance * int64(nights),
			NightChargePaise:     card.nightSurcharge * int64(nights),
			Days:                 days,
			NightsAway:           nights,
			IncludedHours:        days * outstationHoursPerDay,
		}, true

	case PackageMonthly:
		return PackageQuote{BasePaise: monthlyCard[tier]}, true

	default:
		return PackageQuote{}, false
	}
}

// isPackageBooking reports whether a request selects a package tier (vs distance pricing).
func isPackageBooking(packageType string) bool {
	switch strings.ToUpper(strings.TrimSpace(packageType)) {
	case PackageHourly, PackageMiniOutstation, PackageOutstation, PackageMonthly:
		return true
	default:
		return false
	}
}

func envPaise(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			return n
		}
	}
	return def
}
