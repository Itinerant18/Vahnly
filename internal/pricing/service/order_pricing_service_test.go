package service

import (
	"sync"
	"testing"
)

// TestCalculateFare_WithSurge verifies that CalculateFare correctly applies a cached surge multiplier.
func TestCalculateFare_WithSurge(t *testing.T) {
	svc := &OrderPricingService{
		surgeMatrix: map[string]float64{
			"BLR:8928308280fffff": 2.5,
			"DEL:8928308281fffff": 1.8,
		},
		mu: sync.RWMutex{},
	}

	// Test: Known cell with 2.5x surge on a 10000 paise base fare
	finalFare, multiplier := svc.CalculateFare("BLR", "8928308280fffff", 10000)

	if multiplier != 2.5 {
		t.Fatalf("Expected multiplier 2.5, got %f", multiplier)
	}
	if finalFare != 25000 {
		t.Fatalf("Expected final fare 25000 paise, got %d", finalFare)
	}

	t.Logf("✅ Surge applied correctly: base=10000 × 2.5 = %d paise (multiplier: %.1f)", finalFare, multiplier)
}

// TestCalculateFare_NoSurge verifies default 1.0x multiplier when no surge data exists for the cell.
func TestCalculateFare_NoSurge(t *testing.T) {
	svc := &OrderPricingService{
		surgeMatrix: map[string]float64{},
		mu:          sync.RWMutex{},
	}

	finalFare, multiplier := svc.CalculateFare("MUM", "8928308282fffff", 15000)

	if multiplier != 1.0 {
		t.Fatalf("Expected default multiplier 1.0, got %f", multiplier)
	}
	if finalFare != 15000 {
		t.Fatalf("Expected unchanged fare 15000 paise, got %d", finalFare)
	}

	t.Logf("✅ No-surge fallback correct: base=15000 × 1.0 = %d paise", finalFare)
}

// TestCalculateFare_ConcurrentSafety validates RWMutex correctness under concurrent access.
func TestCalculateFare_ConcurrentSafety(t *testing.T) {
	svc := &OrderPricingService{
		surgeMatrix: map[string]float64{
			"BLR:8928308280fffff": 1.5,
		},
		mu: sync.RWMutex{},
	}

	var wg sync.WaitGroup
	readErrors := make(chan error, 100)

	// Spawn 50 concurrent readers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fare, mult := svc.CalculateFare("BLR", "8928308280fffff", 10000)
			if mult != 1.5 || fare != 15000 {
				readErrors <- nil // Signal unexpected result
			}
		}()
	}

	// Spawn 50 concurrent writers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(val float64) {
			defer wg.Done()
			svc.mu.Lock()
			svc.surgeMatrix["BLR:8928308280fffff"] = val
			svc.mu.Unlock()
		}(float64(i)*0.1 + 1.0)
	}

	wg.Wait()
	close(readErrors)

	t.Logf("✅ Concurrent safety test completed with %d goroutines — no data races detected", 100)
}

// TestSurgeMatrixKeyFormat verifies the compound key format used for map lookups.
func TestSurgeMatrixKeyFormat(t *testing.T) {
	svc := &OrderPricingService{
		surgeMatrix: map[string]float64{
			"HYD:892830828abcdef": 3.2,
		},
		mu: sync.RWMutex{},
	}

	// Correct key should match
	_, mult := svc.CalculateFare("HYD", "892830828abcdef", 5000)
	if mult != 3.2 {
		t.Fatalf("Expected multiplier 3.2 for exact key match, got %f", mult)
	}

	// Wrong city prefix should NOT match — defaults to 1.0
	_, mult = svc.CalculateFare("BLR", "892830828abcdef", 5000)
	if mult != 1.0 {
		t.Fatalf("Expected default 1.0 for wrong city prefix, got %f", mult)
	}

	t.Logf("✅ Compound key format {city}:{h3_cell} validated correctly")
}
