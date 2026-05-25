package matcher_test

import (
	"context"
	"math"
	"testing"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/dispatch/matcher"
)

func TestEvaluateGreedyMatch_Success(t *testing.T) {
	ctx := context.Background()

	order := domain.OrderCreatedPayload{
		OrderID:       "order-1",
		CityPrefix:    "NYC",
		PickupH3Cell:  "882a100d2dfffff",
		PickupLat:     40.7128,
		PickupLng:     -74.0060,
		BaseFarePaise: 500,
	}

	// Cost = (0.45 * ETA) + (0.25 * (1 - AR)) + (0.15 * CP) + (0.10 * SurgePenalty) + (0.05 * (1 / (Idle + 1)))
	candidates := []matcher.CandidateDriver{
		{
			DriverID:                "driver-far-high-ar",
			DistanceMeters:          100.0,
			AcceptanceRate:          0.95,
			CancellationProbability: 0.02,
			IsInsideSurgeZone:       true,
			IdleSeconds:             120.0,
		},
		{
			DriverID:                "driver-close-no-surge",
			DistanceMeters:          10.0,
			AcceptanceRate:          0.90,
			CancellationProbability: 0.01,
			IsInsideSurgeZone:       false,
			IdleSeconds:             10.0,
		},
		{
			DriverID:                "driver-closest-high-ar",
			DistanceMeters:          10.0,
			AcceptanceRate:          0.90,
			CancellationProbability: 0.01,
			IsInsideSurgeZone:       true,
			IdleSeconds:             10.0,
		},
	}

	res, err := matcher.EvaluateGreedyMatch(ctx, order, candidates)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if res.OrderID != order.OrderID {
		t.Errorf("Expected OrderID %s, got %s", order.OrderID, res.OrderID)
	}

	expectedDriver := "driver-closest-high-ar"
	if res.DriverID != expectedDriver {
		t.Errorf("Expected optimal DriverID %s, got %s", expectedDriver, res.DriverID)
	}

	// Calculate expected score precisely as the algorithm does:
	// estimatedEtaSeconds := 10.0 / 11.1
	// surgePenalty := 0.0 (inside surge zone)
	// costScore := (0.45 * (10.0 / 11.1)) + (0.25 * float64(1.0 - 0.90)) + (0.15 * float64(0.01)) + (0.10 * 0.0) + (0.05 * (1.0 / 11.0))
	etaVal := 10.0 / 11.1
	arVal := float64(1.0 - float32(0.90))
	cpVal := float64(float32(0.01))
	surgeVal := 0.0
	idleVal := 1.0 / (10.0 + 1.0)
	
	expectedScore := (0.45 * etaVal) + (0.25 * arVal) + (0.15 * cpVal) + (0.10 * surgeVal) + (0.05 * idleVal)
	
	if math.Abs(res.Score-expectedScore) > 1e-9 {
		t.Errorf("Expected Score close to %f, got %f (diff: %e)", expectedScore, res.Score, math.Abs(res.Score-expectedScore))
	}
}

func TestEvaluateGreedyMatch_Starvation(t *testing.T) {
	ctx := context.Background()
	order := domain.OrderCreatedPayload{OrderID: "order-empty"}

	_, err := matcher.EvaluateGreedyMatch(ctx, order, nil)
	if err == nil {
		t.Fatal("Expected starvation error, got nil")
	}
}
