package matcher

import (
	"context"
	"math"
	"testing"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
)

// TestSolveKuhnMunkres_SquareMatrix validates a known-optimal 3×3 assignment
func TestSolveKuhnMunkres_SquareMatrix(t *testing.T) {
	// Classic example: optimal is (0→2, 1→0, 2→1) with total cost = 3+2+3 = 8
	matrix := [][]float64{
		{9, 11, 3},
		{2, 8, 7},
		{4, 3, 5},
	}

	assignments := SolveKuhnMunkres(matrix)

	if len(assignments) != 3 {
		t.Fatalf("Expected 3 assignments, got %d", len(assignments))
	}

	totalCost := 0.0
	for row, col := range assignments {
		totalCost += matrix[row][col]
	}

	if totalCost != 8.0 {
		t.Errorf("Expected total cost 8.0, got %.1f (assignments: %v)", totalCost, assignments)
	}
}

// TestSolveKuhnMunkres_1x1 validates the degenerate single-element case
func TestSolveKuhnMunkres_1x1(t *testing.T) {
	matrix := [][]float64{{42.0}}
	assignments := SolveKuhnMunkres(matrix)

	if len(assignments) != 1 {
		t.Fatalf("Expected 1 assignment, got %d", len(assignments))
	}
	if col, ok := assignments[0]; !ok || col != 0 {
		t.Errorf("Expected row 0 → col 0, got %v", assignments)
	}
}

// TestSolveKuhnMunkres_AllEqual tests tie-breaking with uniform costs
func TestSolveKuhnMunkres_AllEqual(t *testing.T) {
	matrix := [][]float64{
		{5, 5, 5},
		{5, 5, 5},
		{5, 5, 5},
	}
	assignments := SolveKuhnMunkres(matrix)

	if len(assignments) != 3 {
		t.Fatalf("Expected 3 assignments, got %d", len(assignments))
	}

	// Each row must be assigned to a unique column
	usedCols := make(map[int]bool)
	for _, col := range assignments {
		if usedCols[col] {
			t.Errorf("Column %d assigned twice — bipartite constraint violated", col)
		}
		usedCols[col] = true
	}
}

// TestSolveKuhnMunkres_LargeIdentity validates that an identity-like matrix
// assigns each row to itself (diagonal)
func TestSolveKuhnMunkres_LargeIdentity(t *testing.T) {
	n := 10
	matrix := make([][]float64, n)
	for i := range matrix {
		matrix[i] = make([]float64, n)
		for j := range matrix[i] {
			if i == j {
				matrix[i][j] = 0
			} else {
				matrix[i][j] = 100
			}
		}
	}

	assignments := SolveKuhnMunkres(matrix)

	totalCost := 0.0
	for row, col := range assignments {
		totalCost += matrix[row][col]
		if row != col {
			t.Errorf("Expected diagonal assignment: row %d → col %d, got col %d", row, row, col)
		}
	}

	if totalCost != 0.0 {
		t.Errorf("Expected total cost 0.0, got %.1f", totalCost)
	}
}

// TestEvaluateHungarianBatch_ZeroDrivers returns nil gracefully
func TestEvaluateHungarianBatch_ZeroDrivers(t *testing.T) {
	orders := []domain.OrderCreatedPayload{{OrderID: "o1"}}
	results, err := EvaluateHungarianBatch(context.Background(), orders, nil, nil, nil)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if results != nil {
		t.Errorf("Expected nil results for zero drivers, got %v", results)
	}
}

// TestEvaluateHungarianBatch_ZeroOrders returns nil gracefully
func TestEvaluateHungarianBatch_ZeroOrders(t *testing.T) {
	drivers := []CandidateDriver{{DriverID: "d1"}}
	results, err := EvaluateHungarianBatch(context.Background(), nil, drivers, nil, nil)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if results != nil {
		t.Errorf("Expected nil results for zero orders, got %v", results)
	}
}

// TestEvaluateHungarianBatch_SingleOrderSingleDriver validates the 1×1 case
func TestEvaluateHungarianBatch_SingleOrderSingleDriver(t *testing.T) {
	order := domain.OrderCreatedPayload{
		OrderID:         "test-order-1",
		CityPrefix:      "KOL",
		PickupOSMNodeID: 100,
	}
	driver := CandidateDriver{
		DriverID:       "test-driver-1",
		OSMNodeID:      200,
		H3Cell:         "882a100d2dfffff",
		DistanceMeters: 1000,
		AcceptanceRate: 0.95,
		IdleSeconds:    300,
	}

	driverMap := map[string][]CandidateDriver{
		"test-order-1": {driver},
	}

	results, err := EvaluateHungarianBatch(context.Background(),
		[]domain.OrderCreatedPayload{order},
		[]CandidateDriver{driver},
		driverMap,
		nil, // no ETA corrector — uses distance fallback
	)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("Expected 1 match, got %d", len(results))
	}
	if results[0].OrderID != "test-order-1" || results[0].DriverID != "test-driver-1" {
		t.Errorf("Wrong match: %+v", results[0])
	}
	if results[0].DriverH3Cell != driver.H3Cell {
		t.Errorf("Expected driver H3 cell %s, got %s", driver.H3Cell, results[0].DriverH3Cell)
	}
}

// TestEvaluateHungarianBatch_AllHighPenalty no matches when all costs exceed threshold
func TestEvaluateHungarianBatch_AllHighPenalty(t *testing.T) {
	order := domain.OrderCreatedPayload{
		OrderID:    "test-order-1",
		CityPrefix: "KOL",
	}
	driver := CandidateDriver{
		DriverID:       "test-driver-1",
		DistanceMeters: 1000,
	}

	// Driver is NOT in the order's candidate map → triggers 1e7 high penalty
	driverMap := map[string][]CandidateDriver{
		"test-order-1": {}, // empty candidates
	}

	results, err := EvaluateHungarianBatch(context.Background(),
		[]domain.OrderCreatedPayload{order},
		[]CandidateDriver{driver},
		driverMap,
		nil,
	)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("Expected 0 matches for all-high-penalty matrix, got %d: %+v", len(results), results)
	}
}

// TestEvaluateHungarianBatch_RectangularMoreDrivers 2 orders × 4 drivers
func TestEvaluateHungarianBatch_RectangularMoreDrivers(t *testing.T) {
	orders := []domain.OrderCreatedPayload{
		{OrderID: "o1", CityPrefix: "KOL", PickupOSMNodeID: 10},
		{OrderID: "o2", CityPrefix: "KOL", PickupOSMNodeID: 20},
	}
	drivers := []CandidateDriver{
		{DriverID: "d1", DistanceMeters: 500, AcceptanceRate: 0.9, IdleSeconds: 100},
		{DriverID: "d2", DistanceMeters: 800, AcceptanceRate: 0.8, IdleSeconds: 200},
		{DriverID: "d3", DistanceMeters: 300, AcceptanceRate: 0.95, IdleSeconds: 50},
		{DriverID: "d4", DistanceMeters: 1200, AcceptanceRate: 0.7, IdleSeconds: 10},
	}
	driverMap := map[string][]CandidateDriver{
		"o1": drivers,
		"o2": drivers,
	}

	results, err := EvaluateHungarianBatch(context.Background(), orders, drivers, driverMap, nil)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("Expected 2 matches, got %d", len(results))
	}

	// Verify no driver is assigned twice (bipartite constraint)
	assignedDrivers := make(map[string]bool)
	for _, r := range results {
		if assignedDrivers[r.DriverID] {
			t.Errorf("Driver %s assigned to multiple orders — bipartite violation", r.DriverID)
		}
		assignedDrivers[r.DriverID] = true
	}
}

// TestEvaluateHungarianBatch_RectangularMoreOrders 4 orders × 2 drivers
func TestEvaluateHungarianBatch_RectangularMoreOrders(t *testing.T) {
	orders := []domain.OrderCreatedPayload{
		{OrderID: "o1", CityPrefix: "KOL"},
		{OrderID: "o2", CityPrefix: "KOL"},
		{OrderID: "o3", CityPrefix: "KOL"},
		{OrderID: "o4", CityPrefix: "KOL"},
	}
	drivers := []CandidateDriver{
		{DriverID: "d1", DistanceMeters: 500, AcceptanceRate: 0.9, IdleSeconds: 100},
		{DriverID: "d2", DistanceMeters: 800, AcceptanceRate: 0.8, IdleSeconds: 200},
	}
	driverMap := map[string][]CandidateDriver{
		"o1": drivers, "o2": drivers, "o3": drivers, "o4": drivers,
	}

	results, err := EvaluateHungarianBatch(context.Background(), orders, drivers, driverMap, nil)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Can only match 2 (limited by driver count)
	if len(results) > 2 {
		t.Errorf("Expected at most 2 matches (2 drivers), got %d", len(results))
	}

	// Verify bipartite constraint
	assignedDrivers := make(map[string]bool)
	for _, r := range results {
		if assignedDrivers[r.DriverID] {
			t.Errorf("Driver %s assigned to multiple orders — bipartite violation", r.DriverID)
		}
		assignedDrivers[r.DriverID] = true
	}
}

// TestComputeSingleEdgeCost_Deterministic validates the cost formula with known inputs
func TestComputeSingleEdgeCost_Deterministic(t *testing.T) {
	order := domain.OrderCreatedPayload{
		OrderID:         "test-order",
		PickupOSMNodeID: 100,
	}
	driver := CandidateDriver{
		DriverID:                "test-driver",
		DistanceMeters:          1110, // 1110 / 11.1 = 100 seconds
		AcceptanceRate:          0.90,
		CancellationProbability: 0.05,
		IsInsideSurgeZone:       true,
		IdleSeconds:             99.0,
	}

	cost, eta := ComputeSingleEdgeCost(context.Background(), order, driver, nil)

	// Expected ETA = 1110 / 11.1 = 100.0
	expectedEta := 100.0
	if math.Abs(eta-expectedEta) > 0.01 {
		t.Errorf("Expected ETA %.2f, got %.2f", expectedEta, eta)
	}

	// Cost = 0.45*100 + 0.25*(1-0.9) + 0.15*0.05 + 0.10*0 + 0.05*(1/100)
	//      = 45 + 0.025 + 0.0075 + 0 + 0.0005 = 45.033
	expectedCost := 45.033
	if math.Abs(cost-expectedCost) > 0.01 {
		t.Errorf("Expected cost ~%.3f, got %.3f", expectedCost, cost)
	}
}
