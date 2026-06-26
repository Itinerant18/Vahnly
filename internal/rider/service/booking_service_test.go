package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeQuoter struct {
	fare float64
	mult float64
}

func (f fakeQuoter) GetFareQuote(_ context.Context, _, _ string, _ float64) (int64, float64, error) {
	return int64(f.fare), f.mult, nil
}

// newFareSvc builds a BookingService usable for EstimateFare only (no DB/Redis).
func newFareSvc(fare int64, mult float64) *BookingService {
	return NewBookingService(nil, nil, fakeQuoter{fare: float64(fare), mult: mult}, NewStaticPromoValidator(), nil, nil, nil, nil)
}

// Kolkata-ish pickup inside the India bounding box.
const (
	kolLat = 22.5726
	kolLng = 88.3639
)

func dropoff(lat, lng float64) (*float64, *float64) { return &lat, &lng }

// noon IST so the night charge never triggers in deterministic tests.
func noonIST() *time.Time {
	t := time.Date(2026, 1, 15, 12, 0, 0, 0, istZone)
	return &t
}

func baseReq() FareEstimateRequest {
	dlat, dlng := dropoff(kolLat+0.02, kolLng+0.02)
	return FareEstimateRequest{
		PickupLat: kolLat, PickupLng: kolLng,
		DropoffLat: dlat, DropoffLng: dlng,
		TripType: "IN_CITY_ONE_WAY", CarType: "SEDAN", Transmission: "MANUAL",
		ScheduledAt: noonIST(), PaymentMethod: "CASH", City: "KOL",
	}
}

func TestEstimateFare_BasicNoExtras(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	est, err := svc.EstimateFare(context.Background(), baseReq())
	if err != nil {
		t.Fatalf("estimate: %v", err)
	}
	b := est.FareBreakdown
	wantBase, _ := meteredRateFor("SEDAN")
	if b.BaseFarePaise != wantBase {
		t.Errorf("base: want %d (sedan tier), got %d", wantBase, b.BaseFarePaise)
	}
	if b.DistanceChargePaise <= 0 {
		t.Errorf("distance charge should be > 0 with a dropoff, got %d", b.DistanceChargePaise)
	}
	if b.EstimatedTotalPaise != b.BaseFarePaise+b.DistanceChargePaise {
		t.Errorf("total: want base+distance %d, got %d", b.BaseFarePaise+b.DistanceChargePaise, b.EstimatedTotalPaise)
	}
	if b.NightChargePaise != 0 || b.D4MCarePaise != 0 || b.PromoDiscountPaise != 0 {
		t.Errorf("unexpected extras: %+v", b)
	}
	if est.SurgeActive {
		t.Error("surge should be inactive at multiplier 1.0")
	}
	if est.H3Cell == "" {
		t.Error("expected an H3 cell")
	}
	if est.DriverAvailability != "NONE" {
		t.Errorf("nil cache should yield NONE availability, got %s", est.DriverAvailability)
	}
}

func TestEstimateFare_D4MCareAddsFlat(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	noD4m, _ := svc.EstimateFare(context.Background(), baseReq())
	req := baseReq()
	req.D4MCare = true
	est, _ := svc.EstimateFare(context.Background(), req)
	if est.FareBreakdown.D4MCarePaise != d4mCarePaise {
		t.Errorf("d4m charge: want %d, got %d", d4mCarePaise, est.FareBreakdown.D4MCarePaise)
	}
	wantD4m := noD4m.FareBreakdown.EstimatedTotalPaise + d4mCarePaise
	if est.FareBreakdown.EstimatedTotalPaise != wantD4m {
		t.Errorf("total with d4m: want %d, got %d", wantD4m, est.FareBreakdown.EstimatedTotalPaise)
	}
}

func TestEstimateFare_NightCharge(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	day, _ := svc.EstimateFare(context.Background(), baseReq()) // noon — no night charge
	req := baseReq()
	night := time.Date(2026, 1, 15, 23, 0, 0, 0, istZone) // 23:00 IST
	req.ScheduledAt = &night
	est, _ := svc.EstimateFare(context.Background(), req)
	if est.FareBreakdown.NightChargePaise != nightChargePaise {
		t.Errorf("night charge: want %d, got %d", nightChargePaise, est.FareBreakdown.NightChargePaise)
	}
	wantNight := day.FareBreakdown.EstimatedTotalPaise + nightChargePaise
	if est.FareBreakdown.EstimatedTotalPaise != wantNight {
		t.Errorf("total with night: want %d, got %d", wantNight, est.FareBreakdown.EstimatedTotalPaise)
	}
}

func TestEstimateFare_PromoApplied(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	far := baseReq()
	dlat, dlng := dropoff(kolLat+0.06, kolLng+0.06) // farther so the fare clears the ₹100 promo minimum
	far.DropoffLat, far.DropoffLng = dlat, dlng
	noPromo, _ := svc.EstimateFare(context.Background(), far)
	far.PromoCode = "WELCOME50" // flat 5000 off, min 10000
	est, _ := svc.EstimateFare(context.Background(), far)
	if est.FareBreakdown.PromoDiscountPaise != 5000 {
		t.Errorf("promo discount: want 5000, got %d", est.FareBreakdown.PromoDiscountPaise)
	}
	wantPromo := noPromo.FareBreakdown.EstimatedTotalPaise - 5000
	if est.FareBreakdown.EstimatedTotalPaise != wantPromo {
		t.Errorf("total after promo: want %d, got %d", wantPromo, est.FareBreakdown.EstimatedTotalPaise)
	}
}

func TestEstimateFare_SurgeActive(t *testing.T) {
	flat := newFareSvc(0, 1.0)
	preSurge, _ := flat.EstimateFare(context.Background(), baseReq()) // metered fare at 1.0×
	svc := newFareSvc(0, 1.5)
	est, _ := svc.EstimateFare(context.Background(), baseReq())
	if !est.SurgeActive {
		t.Error("surge should be active at multiplier 1.5")
	}
	if est.FareBreakdown.SurgeMultiplier != 1.5 {
		t.Errorf("surge multiplier: want 1.5, got %v", est.FareBreakdown.SurgeMultiplier)
	}
	// dispatchFarePaise = pre-surge metered fare (tier card) × multiplier.
	want := int64(float64(preSurge.FareBreakdown.EstimatedTotalPaise) * 1.5)
	if est.dispatchFarePaise != want {
		t.Errorf("dispatch fare: want %d, got %d", want, est.dispatchFarePaise)
	}
}

func TestEstimateFare_PickupOutOfBounds(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	req := baseReq()
	req.PickupLat = 0 // outside India bbox
	if _, err := svc.EstimateFare(context.Background(), req); !errors.Is(err, ErrInvalidBooking) {
		t.Fatalf("want ErrInvalidBooking, got %v", err)
	}
}

func TestEstimateFare_RoundTripDoublesDistance(t *testing.T) {
	svc := newFareSvc(20000, 1.0)
	oneWay := baseReq()
	oneWayEst, _ := svc.EstimateFare(context.Background(), oneWay)

	round := baseReq()
	round.TripType = "IN_CITY_ROUND"
	roundEst, _ := svc.EstimateFare(context.Background(), round)

	if roundEst.FareBreakdown.DistanceChargePaise <= oneWayEst.FareBreakdown.DistanceChargePaise {
		t.Errorf("round-trip distance charge (%d) should exceed one-way (%d)",
			roundEst.FareBreakdown.DistanceChargePaise, oneWayEst.FareBreakdown.DistanceChargePaise)
	}
}
