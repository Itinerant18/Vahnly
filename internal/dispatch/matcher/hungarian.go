package matcher

import (
	"context"
	"errors"
	"log"
	"math"
	"time"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
)

// RoutingService defines the structural contract decoupled from the CH engine
type RoutingService interface {
	ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error)
}

type CandidateDriver struct {
	DriverID                string
	OSMNodeID               int64 // Pre-mapped closest OpenStreetMap node identifier
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

// EvaluateGreedyMatch scores and returns the immediate minimum cost driver profile using live CH ETAs
func EvaluateGreedyMatch(ctx context.Context, order domain.OrderCreatedPayload, pickupOSMNodeID int64, candidates []CandidateDriver, routingSvc RoutingService) (*MatchResult, error) {
	if len(candidates) == 0 {
		return nil, errors.New("dispatch_starvation: zero available supply within spatial grid")
	}

	// Matrix weights derived from Section 05 configuration defaults
	const (
		alpha   = 0.45 // Weight for ETA
		beta    = 0.25 // Weight for Acceptance Rate
		gamma   = 0.15 // Weight for Cancellation Probability
		delta   = 0.10 // Weight for Surge Penalty
		epsilon = 0.05 // Weight for Driver Idle Time
	)

	var bestDriver CandidateDriver
	lowestCost := math.MaxFloat64
	finalChosenETA := 0.0
	
	for _, driver := range candidates {
		var estimatedEtaSeconds float64
		var err error

		// Enforce an isolated sub-context timeout budget (<30ms) for the graph lookup stage
		routingCtx, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
		
		// 1. Compute road-graph travel time via Contraction Hierarchies Service
		estimatedEtaSeconds, err = routingSvc.ComputeShortestPathETA(routingCtx, driver.OSMNodeID, pickupOSMNodeID)
		cancel()

		if err != nil {
			// SECTION 07 CIRCUIT BREAKER: Fallback to straight-line distance if CH service overloads or fails
			log.Printf("[ROUTING_CIRCUIT_BREAKER] Fallback triggered for driver %s: %v", driver.DriverID, err)
			estimatedEtaSeconds = driver.DistanceMeters / 11.1 // Assumes ~40 km/h baseline velocity template
		}

		surgePenalty := 0.0
		if !driver.IsInsideSurgeZone {
			surgePenalty = 1.0 
		}

		// 2. Compute Multi-Objective Cost Equation
		costScore := (alpha * estimatedEtaSeconds) +
			(beta * float64(1.0-driver.AcceptanceRate)) +
			(gamma * float64(driver.CancellationProbability)) +
			(delta * surgePenalty) +
			(epsilon * (1.0 / (driver.IdleSeconds + 1.0)))

		if costScore < lowestCost {
			lowestCost = costScore
			bestDriver = driver
			finalChosenETA = estimatedEtaSeconds
		}
	}

	return &MatchResult{
		OrderID:             order.OrderID,
		DriverID:            bestDriver.DriverID,
		Score:               lowestCost,
		EstimatedEtaSeconds: int(finalChosenETA),
		CandidatesCount:     len(candidates),
	}, nil
}

// EvaluateHungarianOptimization handles complex combinatorial mapping models
func EvaluateHungarianOptimization(ctx context.Context, order domain.OrderCreatedPayload, pickupOSMNodeID int64, candidates []CandidateDriver, routingSvc RoutingService) (*MatchResult, error) {
	// At launch scales (<500 concurrent items), traffic is safely channeled through the greedy score function
	return EvaluateGreedyMatch(ctx, order, pickupOSMNodeID, candidates, routingSvc)
}
