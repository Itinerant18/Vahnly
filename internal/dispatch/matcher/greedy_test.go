package matcher_test

import (
	"context"
	"fmt"
	"math"
	"testing"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/dispatch/matcher"
)

type mockRoutingService struct {
	computeFunc func(ctx context.Context, sourceID, targetID int64) (float64, error)
}

func (m *mockRoutingService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	if m.computeFunc != nil {
		return m.computeFunc(ctx, sourceID, targetID)
	}
	// Return a predictable travel time based on distance (e.g. sourceID/10)
	return float64(sourceID) / 10.0, nil
}

type dummyETACorrector struct {
	routingSvc matcher.RoutingService
}

func (d *dummyETACorrector) ComputeCorrectedETA(ctx context.Context, sourceNodeID, targetNodeID int64, demandDensity, supplyDensity float32) (float64, error) {
	return d.routingSvc.ComputeShortestPathETA(ctx, sourceNodeID, targetNodeID)
}

func (d *dummyETACorrector) ComputeCancellationRisk(ctx context.Context, features []float32) (float64, error) {
	// Return a default safe probability of cancellation (e.g., 10%) for tests
	return 0.1, nil
}

func TestEvaluateGreedyMatch_Success(t *testing.T) {
	ctx := context.Background()

	order := domain.OrderCreatedPayload{
		OrderID:         "order-1",
		CityPrefix:      "NYC",
		PickupH3Cell:    "882a100d2dfffff",
		PickupLat:       40.7128,
		PickupLng:       -74.0060,
		PickupOSMNodeID: 9999,
		BaseFarePaise:   500,
	}

	// Cost = (0.45 * ETA) + (0.25 * (1 - AR)) + (0.15 * CP) + (0.10 * SurgePenalty) + (0.05 * (1 / (Idle + 1)))
	candidates := []matcher.CandidateDriver{
		{
			DriverID:                "driver-far-high-ar",
			OSMNodeID:               100, // ETA will be 100/10 = 10.0s
			DistanceMeters:          100.0,
			AcceptanceRate:          0.95,
			CancellationProbability: 0.02,
			IsInsideSurgeZone:       true,
			IdleSeconds:             120.0,
		},
		{
			DriverID:                "driver-close-no-surge",
			OSMNodeID:               10, // ETA will be 10/10 = 1.0s
			DistanceMeters:          10.0,
			AcceptanceRate:          0.90,
			CancellationProbability: 0.01,
			IsInsideSurgeZone:       false,
			IdleSeconds:             10.0,
		},
		{
			DriverID:                "driver-closest-high-ar",
			OSMNodeID:               10, // ETA will be 10/10 = 1.0s
			DistanceMeters:          10.0,
			AcceptanceRate:          0.90,
			CancellationProbability: 0.01,
			IsInsideSurgeZone:       true,
			IdleSeconds:             10.0,
		},
	}

	mockSvc := &mockRoutingService{}
	corrector := &dummyETACorrector{routingSvc: mockSvc}

	res, err := matcher.EvaluateGreedyMatch(ctx, order, order.PickupOSMNodeID, candidates, corrector)
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
	// estimatedEtaSeconds := 1.0 (from mockRoutingService)
	// surgePenalty := 0.0 (inside surge zone)
	// costScore := (0.40 * 1.0) + (0.20 * float64(1.0 - 0.90)) + (0.15 * float64(0.01)) + (0.10 * 0.0) + (0.05 * (1.0 / 11.0)) + (0.10 * 0.1)
	etaVal := 1.0
	arVal := float64(1.0 - float32(0.90))
	cpVal := float64(float32(0.01))
	surgeVal := 0.0
	idleVal := 1.0 / (10.0 + 1.0)
	riskVal := 0.1
	
	expectedScore := (0.40 * etaVal) + (0.20 * arVal) + (0.15 * cpVal) + (0.10 * surgeVal) + (0.05 * idleVal) + (0.10 * riskVal)
	
	if math.Abs(res.Score-expectedScore) > 1e-9 {
		t.Errorf("Expected Score close to %f, got %f (diff: %e)", expectedScore, res.Score, math.Abs(res.Score-expectedScore))
	}
}

func TestEvaluateGreedyMatch_Starvation(t *testing.T) {
	ctx := context.Background()
	order := domain.OrderCreatedPayload{OrderID: "order-empty"}
	mockSvc := &mockRoutingService{}
	corrector := &dummyETACorrector{routingSvc: mockSvc}

	_, err := matcher.EvaluateGreedyMatch(ctx, order, 9999, nil, corrector)
	if err == nil {
		t.Fatal("Expected starvation error, got nil")
	}
}

func TestEvaluateGreedyMatch_CircuitBreakerFallback(t *testing.T) {
	ctx := context.Background()

	order := domain.OrderCreatedPayload{
		OrderID:         "order-cb",
		CityPrefix:      "NYC",
		PickupH3Cell:    "882a100d2dfffff",
		PickupLat:       40.7128,
		PickupLng:       -74.0060,
		PickupOSMNodeID: 9999,
		BaseFarePaise:   500,
	}

	candidates := []matcher.CandidateDriver{
		{
			DriverID:                "driver-fallback",
			OSMNodeID:               100,
			DistanceMeters:          111.0, // fallback ETA = 111.0 / 11.1 = 10.0s
			AcceptanceRate:          0.90,
			CancellationProbability: 0.00,
			IsInsideSurgeZone:       true,
			IdleSeconds:             9.0,
		},
	}

	// Mock routing service returns error to trigger circuit breaker
	failingSvc := &mockRoutingService{
		computeFunc: func(ctx context.Context, sourceID, targetID int64) (float64, error) {
			return 0, fmt.Errorf("network lookup failure")
		},
	}
	corrector := &dummyETACorrector{routingSvc: failingSvc}

	res, err := matcher.EvaluateGreedyMatch(ctx, order, order.PickupOSMNodeID, candidates, corrector)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify fallback ETA is used: 111.0 / 11.1 = 10s
	expectedETA := 10
	if res.EstimatedEtaSeconds != expectedETA {
		t.Errorf("Expected fallback ETA %d, got %d", expectedETA, res.EstimatedEtaSeconds)
	}
}
