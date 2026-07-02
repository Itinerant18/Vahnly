package service

import (
	"context"
	"errors"
	"testing"
)

func TestValidateTrip(t *testing.T) {
	cases := []struct {
		name     string
		tripType string
		pkg      string
		hasDrop  bool
		want     error
	}{
		{"one-way without drop rejected", "IN_CITY_ONE_WAY", "", false, ErrDropoffRequired},
		{"one-way with drop ok", "IN_CITY_ONE_WAY", "", true, nil},
		{"outstation without drop rejected", "OUTSTATION", "OUTSTATION", false, ErrDropoffRequired},
		{"mini-outstation without drop rejected", "MINI_OUTSTATION", "MINI_OUTSTATION", false, ErrDropoffRequired},
		{"round trip needs no drop", "IN_CITY_ROUND", "", false, nil},
		{"hourly needs no drop", "IN_CITY_HOURLY", "HOURLY", false, nil},
		{"monthly needs no drop", "MONTHLY", "MONTHLY", false, nil},
		{"unknown type rejected", "TELEPORT", "", true, ErrInvalidBooking},
		{"empty type lenient (legacy clients)", "", "", false, nil},
		{"case/space insensitive", "  in_city_one_way ", "", true, nil},
		// package coupling — the pricing-engine hole
		{"hourly without its package rejected", "IN_CITY_HOURLY", "", false, ErrInvalidBooking},
		{"outstation without its package rejected", "OUTSTATION", "", true, ErrInvalidBooking},
		{"outstation with wrong package rejected", "OUTSTATION", "HOURLY", true, ErrInvalidBooking},
		{"one-way with a package rejected (metered only)", "IN_CITY_ONE_WAY", "HOURLY", true, ErrInvalidBooking},
		{"mini-outstation accepts OUTSTATION package too", "MINI_OUTSTATION", "OUTSTATION", true, nil},
		{"monthly without its package rejected", "MONTHLY", "", false, ErrInvalidBooking},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := validateTrip(c.tripType, c.pkg, c.hasDrop); !errors.Is(got, c.want) {
				t.Errorf("validateTrip(%q, %q, %v) = %v, want %v", c.tripType, c.pkg, c.hasDrop, got, c.want)
			}
		})
	}
}

func TestTripBookable(t *testing.T) {
	if tripBookable("MONTHLY") {
		t.Error("MONTHLY must be estimate-only")
	}
	for _, tt := range []string{"IN_CITY_ONE_WAY", "IN_CITY_ROUND", "IN_CITY_HOURLY", "MINI_OUTSTATION", "OUTSTATION", ""} {
		if !tripBookable(tt) {
			t.Errorf("%q should be bookable", tt)
		}
	}
}

func TestTripCatalog(t *testing.T) {
	all := TripCatalog(nil)
	if len(all) != 6 {
		t.Fatalf("empty filter should return all 6 tiers, got %d", len(all))
	}
	if all[0].Value != "IN_CITY_ONE_WAY" || !all[0].NeedsDropoff {
		t.Errorf("one-way must be first and need a dropoff: %+v", all[0])
	}
	for _, e := range all {
		if e.Label == "" || e.Hint == "" {
			t.Errorf("%s: label/hint must be non-empty", e.Value)
		}
		if e.Value == "MONTHLY" && e.Bookable {
			t.Errorf("MONTHLY must be estimate-only in the catalog")
		}
	}

	filtered := TripCatalog([]string{"in_city_round", "OUTSTATION"})
	if len(filtered) != 2 || filtered[0].Value != "IN_CITY_ROUND" || filtered[1].Value != "OUTSTATION" {
		t.Errorf("filter should keep order and match case-insensitively: %+v", filtered)
	}
}

func TestEstimateFare_OneWayWithoutDropoffRejected(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	req := baseReq()
	req.DropoffLat, req.DropoffLng = nil, nil
	if _, err := svc.EstimateFare(context.Background(), req); !errors.Is(err, ErrDropoffRequired) {
		t.Fatalf("want ErrDropoffRequired, got %v", err)
	}
}

func TestEstimateFare_RoundTripWithoutDropoffAllowed(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	req := baseReq()
	req.TripType = "IN_CITY_ROUND"
	req.DropoffLat, req.DropoffLng = nil, nil
	if _, err := svc.EstimateFare(context.Background(), req); err != nil {
		t.Fatalf("round trip without dropoff should estimate, got %v", err)
	}
}

func TestEstimateFare_UnknownTripTypeRejected(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	req := baseReq()
	req.TripType = "WARP_DRIVE"
	if _, err := svc.EstimateFare(context.Background(), req); !errors.Is(err, ErrInvalidBooking) {
		t.Fatalf("want ErrInvalidBooking, got %v", err)
	}
}
