package usecase

import (
	"context"
	"log"
	"time"

	"github.com/platform/driver-delivery/internal/dispatch/matcher"
	"github.com/platform/driver-delivery/internal/intelligence/client"
)

type ETACorrectorUseCase struct {
	tritonClient *client.TritonClient
	baseRouter   matcher.RoutingService
	modelName    string
}

func NewETACorrectorUseCase(tc *client.TritonClient, br matcher.RoutingService) *ETACorrectorUseCase {
	return &ETACorrectorUseCase{
		tritonClient: tc,
		baseRouter:   br,
		modelName:    "xgboost_spatial_corrector", // Target production model tag
	}
}

// ComputeCorrectedETA combines structural topological paths with contextual ML corrections
func (uc *ETACorrectorUseCase) ComputeCorrectedETA(ctx context.Context, sourceNodeID, targetNodeID int64, demandDensity, supplyDensity float32) (float64, error) {
	// 1. Fetch exact structural baseline route ETA from our in-memory CH graph engine
	baseETA, err := uc.baseRouter.ComputeShortestPathETA(ctx, sourceNodeID, targetNodeID)
	if err != nil {
		return 0.0, err
	}

	// If Triton client is not configured, fallback directly to the baseline route ETA
	if uc.tritonClient == nil {
		return baseETA, nil
	}

	// 2. Hydrate tabular features array mapped to the trained model's matrix signature
	now := time.Now()
	features := []float32{
		float32(baseETA),
		float32(now.Hour()),
		float32(now.Weekday()),
		demandDensity,
		supplyDensity,
	}

	// Enforce a strict sub-context timeout budget (<12ms) for the ML inference phase
	inferenceCtx, cancel := context.WithTimeout(ctx, 12*time.Millisecond)
	defer cancel()

	// 3. Query Triton Inference cluster for the spatial multiplier
	multiplier, err := uc.tritonClient.PredictETAMultiplier(inferenceCtx, uc.modelName, "1", features)
	if err != nil {
		// CIRCUIT BREAKER FALLBACK: If Triton overloads or logs an error, instantly return
		// the baseline CH routing output to maintain our sub-500ms processing latency SLA
		log.Printf("[INTELLIGENCE_FALLBACK] Triton inference failed. Using baseline CH ETA: %v", err)
		return baseETA, nil
	}

	// Apply spatial correction factor to the topological metric
	correctedETA := baseETA * float64(multiplier)
	return correctedETA, nil
}

// ComputeCancellationRisk queries the secondary classification tree model on Triton
func (uc *ETACorrectorUseCase) ComputeCancellationRisk(ctx context.Context, features []float32) (float64, error) {
	if uc.tritonClient == nil {
		return 0.0, nil
	}

	// Enforce a strict sub-context timeout budget (<12ms) for the ML classification phase
	inferenceCtx, cancel := context.WithTimeout(ctx, 12*time.Millisecond)
	defer cancel()

	risk, err := uc.tritonClient.PredictETAMultiplier(inferenceCtx, "cancellation_risk_classifier", "1", features)
	if err != nil {
		// CIRCUIT BREAKER FALLBACK: If Triton overloads or logs an error, instantly return
		// a neutral risk score (0.0) to maintain our processing SLA.
		log.Printf("[INTELLIGENCE_FALLBACK] Triton cancellation risk inference failed. Using default 0.0: %v", err)
		return 0.0, nil
	}

	return float64(risk), nil
}
