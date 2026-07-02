package service

import (
	"errors"
	"slices"
	"strings"
)

// ErrDropoffRequired rejects point-to-point / outstation bookings without a
// destination — otherwise the dropoff falls back to pickup and prices ~zero km.
var ErrDropoffRequired = errors.New("this trip type requires a drop-off location")

// tripSpec declares what a trip type requires, server-side. Single source of
// truth mirrored by the rider app's bookingBlocker/tripNeedsDropoff (frontend
// guides, backend enforces).
type tripSpec struct {
	NeedsDropoff bool
	Bookable     bool     // false = estimate-only (e.g. MONTHLY until recurring billing lands)
	Packages     []string // allowed package_type values; "" entry = metered allowed
}

var tripSpecs = map[string]tripSpec{
	"IN_CITY_ONE_WAY": {NeedsDropoff: true, Bookable: true, Packages: []string{""}},
	// ROUND is currently metered (package empty). Known product gap: with no
	// dropoff the metered fare is base-only — pricing model decision pending.
	"IN_CITY_ROUND":  {Bookable: true, Packages: []string{""}},
	"IN_CITY_HOURLY": {Bookable: true, Packages: []string{PackageHourly}},
	// retired tier, still valid for old clients; prices as single-day OUTSTATION
	"MINI_OUTSTATION": {NeedsDropoff: true, Bookable: true, Packages: []string{PackageMiniOutstation, PackageOutstation}},
	"OUTSTATION":      {NeedsDropoff: true, Bookable: true, Packages: []string{PackageOutstation}},
	"MONTHLY":         {Packages: []string{PackageMonthly}},
}

// validateTrip gates fare estimates and order creation on the trip-type spec.
// Empty trip_type stays lenient (legacy clients estimate metered point-to-point
// with no dropoff requirement); an unknown non-empty value is rejected.
//
// The package coupling closes a pricing hole: without it, an HOURLY or
// OUTSTATION trip sent with an empty package_type would silently fall through
// to the in-city metered engine (roadMeters ≈ 0 → near-base-only fare for
// hours of driving), and a ONE_WAY sent WITH a package would dodge surge.
func validateTrip(tripType, packageType string, hasDropoff bool) error {
	tt := strings.ToUpper(strings.TrimSpace(tripType))
	if tt == "" {
		return nil
	}
	spec, ok := tripSpecs[tt]
	if !ok {
		return ErrInvalidBooking
	}
	if spec.NeedsDropoff && !hasDropoff {
		return ErrDropoffRequired
	}
	pkg := strings.ToUpper(strings.TrimSpace(packageType))
	if !slices.Contains(spec.Packages, pkg) {
		return ErrInvalidBooking
	}
	return nil
}

// tripBookable reports whether a trip type may be booked (vs estimate-only).
// Empty/unknown values pass — CreateOrder's package-type gate still applies.
func tripBookable(tripType string) bool {
	tt := strings.ToUpper(strings.TrimSpace(tripType))
	spec, ok := tripSpecs[tt]
	if !ok {
		return true
	}
	return spec.Bookable
}

// TripTypeInfo is the rider-facing catalog entry served via city-config so the
// app renders labels/hints and requirements from the server instead of
// hardcoding them per client.
type TripTypeInfo struct {
	Value        string `json:"value"`
	Label        string `json:"label"`
	Hint         string `json:"hint"`
	NeedsDropoff bool   `json:"needs_dropoff"`
	Bookable     bool   `json:"bookable"`
}

// tripCatalogOrder fixes display order (maps are unordered).
var tripCatalogOrder = []struct{ value, label, hint string }{
	{"IN_CITY_ONE_WAY", "One-Way", "Pickup & drop are different locations in the city."},
	{"IN_CITY_ROUND", "Round Trip", "Driver waits and brings you back — no drop-off needed."},
	{"IN_CITY_HOURLY", "Hourly", "Book a driver by the hour for multiple stops."},
	{"MINI_OUTSTATION", "Mini Out.", "Short intercity trip — set your out-of-city drop."},
	{"OUTSTATION", "Outstation", "Full intercity trip — set your destination."},
	{"MONTHLY", "Monthly", "Dedicated monthly driver — coming soon."},
}

// TripCatalog returns the ordered trip-type catalog, filtered to the city's
// supported list (empty = all).
func TripCatalog(supported []string) []TripTypeInfo {
	allow := make(map[string]bool, len(supported))
	for _, s := range supported {
		allow[strings.ToUpper(strings.TrimSpace(s))] = true
	}
	out := make([]TripTypeInfo, 0, len(tripCatalogOrder))
	for _, e := range tripCatalogOrder {
		if len(supported) > 0 && !allow[e.value] {
			continue
		}
		spec := tripSpecs[e.value]
		out = append(out, TripTypeInfo{
			Value:        e.value,
			Label:        e.label,
			Hint:         e.hint,
			NeedsDropoff: spec.NeedsDropoff,
			Bookable:     spec.Bookable,
		})
	}
	return out
}
