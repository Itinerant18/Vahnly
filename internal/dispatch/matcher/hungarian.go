package matcher

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
	"github.com/platform/driver-delivery/internal/observability"
)

const maxMatrixCellWorkers = 128

type RoutingService interface {
	ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error)
}

type ETACorrector interface {
	ComputeCorrectedETA(ctx context.Context, sourceNodeID, targetNodeID int64, demandDensity, supplyDensity float32) (float64, error)
	ComputeCancellationRisk(ctx context.Context, features []float32) (float64, error)
}

type CandidateDriver struct {
	DriverID                string
	OSMNodeID               int64
	H3Cell                  string
	DistanceMeters          float64
	AcceptanceRate          float32
	CancellationProbability float32
	IsInsideSurgeZone       bool
	IdleSeconds             float64
	LocalDemandCount        int64 // MILESTONE 2: Real-time demand counter from surge:demand:* ZSet
	LocalSupplyCount        int64 // MILESTONE 2: Real-time supply counter from surge:supply:* ZSet
}

type MatchResult struct {
	OrderID             string
	DriverID            string
	DriverH3Cell        string
	Score               float64
	EstimatedEtaSeconds int
	CandidatesCount     int
}

// ComputeSingleEdgeCost calculates the objective function score for an individual driver-order pair
func ComputeSingleEdgeCost(ctx context.Context, order domain.OrderCreatedPayload, driver CandidateDriver, etaCorrector ETACorrector) (float64, float64) {
	const (
		alpha   = 0.40 // Weight for ETA
		beta    = 0.20 // Weight for Acceptance Rate
		gamma   = 0.15 // Weight for Cancellation Probability
		delta   = 0.10 // Weight for Surge Penalty
		epsilon = 0.05 // Weight for Driver Idle Time
		zeta    = 0.10 // Weight for Live ML Cancellation Risk Score (NEW)
	)

	var estimatedEtaSeconds float64
	var err error

	routingCtx, cancel := context.WithTimeout(ctx, 15*time.Millisecond)
	defer cancel()

	// MILESTONE 2: Extract live density fields hydrated by the SpatialScanner pipeline
	demandDensity := float32(driver.LocalDemandCount)
	supplyDensity := float32(driver.LocalSupplyCount)

	if etaCorrector != nil {
		rpcStart := time.Now()
		estimatedEtaSeconds, err = observability.ExecuteWithBreaker(routingCtx, func(cbCtx context.Context) (float64, error) {
			return etaCorrector.ComputeCorrectedETA(cbCtx, driver.OSMNodeID, order.PickupOSMNodeID, demandDensity, supplyDensity)
		})
		observability.TritonRPCDurationSeconds.Observe(time.Since(rpcStart).Seconds())
	} else {
		estimatedEtaSeconds = driver.DistanceMeters / 11.1
	}

	if err != nil {
		estimatedEtaSeconds = driver.DistanceMeters / 11.1 // Circuit-breaker fallback
	}

	// Model 2: Compute Live Cancellation Risk Assessment via Triton Classifier (NEW)
	var cancellationRiskScore float64 = 0.0
	if etaCorrector != nil {
		// Package specific driver behavioral features into the classification tensor vector
		riskFeatures := []float32{
			driver.AcceptanceRate,
			driver.CancellationProbability,
			supplyDensity,
			float32(driver.IdleSeconds),
		}

		// Query the secondary classification tree model on Triton
		riskProb, riskErr := etaCorrector.ComputeCancellationRisk(routingCtx, riskFeatures)
		if riskErr == nil {
			cancellationRiskScore = riskProb

			// FENCE VALUE EXCLUSION: Prune high-risk drivers from matching eligibility entirely
			if cancellationRiskScore >= 0.75 {
				return 1e7, estimatedEtaSeconds
			}
		}
	}

	surgePenalty := 0.0
	if !driver.IsInsideSurgeZone {
		surgePenalty = 1.0
	}

	// Expand the Multi-Objective Cost Equation to include real-time cancellation risk factors
	costScore := (alpha * estimatedEtaSeconds) +
		(beta * float64(1.0-driver.AcceptanceRate)) +
		(gamma * float64(driver.CancellationProbability)) +
		(delta * surgePenalty) +
		(epsilon * (1.0 / (driver.IdleSeconds + 1.0))) +
		(zeta * cancellationRiskScore)

	return costScore, estimatedEtaSeconds
}

// EvaluateHungarianBatch processes pooled entries together using global cost matrix constraints
func EvaluateHungarianBatch(ctx context.Context, orders []domain.OrderCreatedPayload, uniqueDrivers []CandidateDriver, driverLocationMap map[string][]CandidateDriver, etaCorrector ETACorrector) ([]MatchResult, error) {
	nOrders := len(orders)
	nDrivers := len(uniqueDrivers)
	if nOrders == 0 || nDrivers == 0 {
		return nil, nil
	}

	// Size boundaries based on the larger dimension to support rectangular configurations
	matrixSize := nOrders
	if nDrivers > matrixSize {
		matrixSize = nDrivers
	}

	// 1. Initialize and populate the global cost matrix
	costMatrix := make([][]float64, matrixSize)
	for i := range costMatrix {
		costMatrix[i] = make([]float64, matrixSize)
	}

	// Track baseline metrics during grid compilation steps
	etaCache := make([][]int, nOrders)
	for i := range etaCache {
		etaCache[i] = make([]int, nDrivers)
	}

	for i := 0; i < nOrders; i++ {
		for j := 0; j < nDrivers; j++ {
			costMatrix[i][j] = 1e7
			etaCache[i][j] = 9999
		}
	}

	driverIndex := make(map[string]int, nDrivers)
	for j, driver := range uniqueDrivers {
		driverIndex[driver.DriverID] = j
	}

	type edgeJob struct {
		row    int
		col    int
		order  domain.OrderCreatedPayload
		driver CandidateDriver
	}

	// Bound edge-cost compilation to avoid M×N goroutine storms. Only eligible
	// spatial edges are evaluated; non-candidate pairs retain the high penalty.
	jobs := make(chan edgeJob)
	workerCount := min(maxMatrixCellWorkers, max(1, nOrders*nDrivers))
	var wg sync.WaitGroup

	for worker := 0; worker < workerCount; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				cost, etaVal := ComputeSingleEdgeCost(ctx, job.order, job.driver, etaCorrector)
				costMatrix[job.row][job.col] = cost
				etaCache[job.row][job.col] = int(etaVal)
			}
		}()
	}

	var enqueueErr error
enqueueJobs:
	for i, order := range orders {
		seenCols := make(map[int]struct{})
		for _, driver := range driverLocationMap[order.OrderID] {
			col, ok := driverIndex[driver.DriverID]
			if !ok {
				continue
			}
			if _, exists := seenCols[col]; exists {
				continue
			}
			seenCols[col] = struct{}{}

			select {
			case jobs <- edgeJob{row: i, col: col, order: order, driver: driver}:
			case <-ctx.Done():
				enqueueErr = ctx.Err()
				break enqueueJobs
			}
		}
	}
	close(jobs)
	wg.Wait()
	if enqueueErr != nil {
		return nil, enqueueErr
	}

	// 2. Pad rows if orders < drivers, initializing with neutral costs
	for i := nOrders; i < matrixSize; i++ {
		for j := 0; j < matrixSize; j++ {
			costMatrix[i][j] = 0
		}
	}
	// 3. Pad columns if drivers < orders, initializing with high penalty values
	for i := 0; i < nOrders; i++ {
		for j := nDrivers; j < matrixSize; j++ {
			costMatrix[i][j] = 1e7
		}
	}

	// 4. Run the Kuhn-Munkres algorithm
	assignments := SolveKuhnMunkres(costMatrix)

	var results []MatchResult
	for row, col := range assignments {
		// Filter out dummy padding rows or columns from final assignments
		if row < nOrders && col < nDrivers {
			targetDriver := uniqueDrivers[col]
			targetOrder := orders[row]
			matchedDriver := targetDriver
			for _, candidate := range driverLocationMap[targetOrder.OrderID] {
				if candidate.DriverID == targetDriver.DriverID {
					matchedDriver = candidate
					break
				}
			}

			// Exclude invalid high-penalty assignments to enforce spatial limits
			if costMatrix[row][col] < 1e6 {
				results = append(results, MatchResult{
					OrderID:             targetOrder.OrderID,
					DriverID:            matchedDriver.DriverID,
					DriverH3Cell:        matchedDriver.H3Cell,
					Score:               costMatrix[row][col],
					EstimatedEtaSeconds: etaCache[row][col],
					CandidatesCount:     nDrivers,
				})
			}
		}
	}

	return results, nil
}

// SolveKuhnMunkres executes the core assignment phase
func SolveKuhnMunkres(matrix [][]float64) map[int]int {
	n := len(matrix)
	u := make([]float64, n+1)
	v := make([]float64, n+1)
	p := make([]int, n+1)
	way := make([]int, n+1)

	for i := 1; i <= n; i++ {
		p[0] = i
		minv := make([]float64, n+1)
		for j := range minv {
			minv[j] = math.MaxFloat64
		}
		used := make([]bool, n+1)
		j0 := 0

		for {
			used[j0] = true
			i0 := p[j0]
			delta := math.MaxFloat64
			j1 := 0

			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := matrix[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] {
						minv[j] = cur
						way[j] = j0
					}
					if minv[j] < delta {
						delta = minv[j]
						j1 = j
					}
				}
			}

			for j := 0; j <= n; j++ {
				if used[j] {
					u[p[j]] += delta
					v[j] -= delta
				} else {
					minv[j] -= delta
				}
			}
			j0 = j1
			if p[j0] == 0 {
				break
			}
		}

		for {
			j1 := way[j0]
			p[j0] = p[j1]
			j0 = j1
			if j0 == 0 {
				break
			}
		}
	}

	result := make(map[int]int)
	for j := 1; j <= n; j++ {
		if p[j] > 0 {
			result[p[j]-1] = j - 1
		}
	}
	return result
}

// EvaluateGreedyMatch scores and returns the immediate minimum cost driver profile using live CH ETAs
func EvaluateGreedyMatch(ctx context.Context, order domain.OrderCreatedPayload, pickupOSMNodeID int64, candidates []CandidateDriver, etaCorrector ETACorrector) (*MatchResult, error) {
	if len(candidates) == 0 {
		return nil, errors.New("dispatch_starvation: zero available supply within spatial grid")
	}
	localPool := append([]CandidateDriver(nil), candidates...)
	res, err := EvaluateHungarianBatch(ctx, []domain.OrderCreatedPayload{order}, localPool, map[string][]CandidateDriver{order.OrderID: localPool}, etaCorrector)
	if err != nil || len(res) == 0 {
		return nil, fmt.Errorf("greedy_fallback_failed: %w", err)
	}
	return &res[0], nil
}

func EvaluateHungarianOptimization(ctx context.Context, order domain.OrderCreatedPayload, pickupOSMNodeID int64, candidates []CandidateDriver, etaCorrector ETACorrector) (*MatchResult, error) {
	return EvaluateGreedyMatch(ctx, order, pickupOSMNodeID, candidates, etaCorrector)
}
