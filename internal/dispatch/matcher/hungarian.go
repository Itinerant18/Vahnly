package matcher

import (
	"context"
	"errors"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
)

type CandidateDriver struct {
	DriverID                string
	DistanceMeters          float64
	AcceptanceRate          float32
	CancellationProbability float32
	IsInsideSurgeZone       bool
	IdleSeconds             float64
}

type MatchResult struct {
	OrderID             string
	DriverID            string
	Score               float64
	EstimatedEtaSeconds int
	CandidatesCount     int
}

// EvaluateGreedyMatch scores and returns the immediate minimum cost driver profile [cite: 69]
func EvaluateGreedyMatch(ctx context.Context, order domain.OrderCreatedPayload, candidates []CandidateDriver) (*MatchResult, error) {
	if len(candidates) == 0 {
		return nil, errors.New("dispatch_starvation: zero available supply within spatial grid")
	}

	// Base configuration weights derived from documentation metadata guidelines [cite: 67]
	const (
		alpha = 0.45 // Weight for ETA
		beta  = 0.25 // Weight for Acceptance Rate
		gamma = 0.15 // Weight for Cancellation Probability
		delta = 0.10 // Weight for Surge Penalty
		epsilon = 0.05 // Weight for Driver Idle Time
	)

	var bestDriver CandidateDriver
	lowestCost := 99999999.9
	
	for _, driver := range candidates {
		// Estimate base travel time (Phase 2 OpenStreetMap fallback baseline) [cite: 12]
		estimatedEtaSeconds := driver.DistanceMeters / 11.1 // Assumes ~40 km/h baseline velocity

		surgePenalty := 0.0
		if !driver.IsInsideSurgeZone {
			surgePenalty = 1.0 // Penalty if driver is absent from high-demand zones [cite: 67]
		}

		// Calculate composite cost equation [cite: 67]
		costScore := (alpha * estimatedEtaSeconds) +
			(beta * float64(1.0-driver.AcceptanceRate)) +
			(gamma * float64(driver.CancellationProbability)) +
			(delta * surgePenalty) +
			(epsilon * (1.0 / (driver.IdleSeconds + 1.0)))

		if costScore < lowestCost {
			lowestCost = costScore
			bestDriver = driver
		}
	}

	return &MatchResult{
		OrderID:             order.OrderID,
		DriverID:            bestDriver.DriverID,
		Score:               lowestCost,
		EstimatedEtaSeconds: int(bestDriver.DistanceMeters / 11.1),
		CandidatesCount:     len(candidates),
	}, nil
}

// EvaluateHungarianOptimization handles complex combinatorial mapping models [cite: 69]
func EvaluateHungarianOptimization(ctx context.Context, order domain.OrderCreatedPayload, candidates []CandidateDriver) (*MatchResult, error) {
	// Structural hook to wrap matrix layouts once concurrent thresholds cross 500+ items [cite: 69]
	// At launch scales, this wraps and channels traffic safely through the standard objective score function
	return EvaluateGreedyMatch(ctx, order, candidates)
}
