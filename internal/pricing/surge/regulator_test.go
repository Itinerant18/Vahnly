package surge

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestSurgeRegulator_CalculateO1HeuristicFallback(t *testing.T) {
	reg := NewSurgeRegulator(0.20, 100*time.Millisecond, 3.5)

	// Case 1: Demand <= Supply -> Multiplier = 1.0
	m1 := reg.CalculateO1HeuristicFallback(5, 5)
	if m1 != 1.0 {
		t.Errorf("Expected 1.0 multiplier when demand <= supply, got %f", m1)
	}

	m2 := reg.CalculateO1HeuristicFallback(3, 5)
	if m2 != 1.0 {
		t.Errorf("Expected 1.0 multiplier when demand <= supply, got %f", m2)
	}

	// Case 2: Demand > Supply -> Multiplier > 1.0
	m3 := reg.CalculateO1HeuristicFallback(10, 2)
	if m3 <= 1.0 {
		t.Errorf("Expected >1.0 multiplier when demand > supply, got %f", m3)
	}

	// Case 3: Cap at maxSurgeLimit
	m4 := reg.CalculateO1HeuristicFallback(1000, 1)
	if m4 != 3.5 {
		t.Errorf("Expected cap at maxSurgeLimit (3.5), got %f", m4)
	}
}

func TestSurgeRegulator_NominalExecution(t *testing.T) {
	reg := NewSurgeRegulator(0.20, 100*time.Millisecond, 3.5)

	mlMock := func() (float64, error) {
		return 1.85, nil
	}

	ctx := context.Background()
	m := reg.ExecuteOrFallback(ctx, mlMock, 5, 2)
	if m != 1.85 {
		t.Errorf("Expected ML value 1.85 under nominal conditions, got %f", m)
	}
}

func TestSurgeRegulator_TimeoutFallback(t *testing.T) {
	reg := NewSurgeRegulator(0.20, 100*time.Millisecond, 3.5)

	// Sleep longer than maxTimeout (30ms) to trigger a context boundary timeout
	slowMLMock := func() (float64, error) {
		time.Sleep(50 * time.Millisecond)
		return 2.5, nil
	}

	ctx := context.Background()
	m := reg.ExecuteOrFallback(ctx, slowMLMock, 10, 2)
	
	// Should fallback to heuristic pricing
	expectedFallback := reg.CalculateO1HeuristicFallback(10, 2)
	if m != expectedFallback {
		t.Errorf("Expected fallback multiplier %f, got %f", expectedFallback, m)
	}
}

func TestSurgeRegulator_FailureStateTransitions(t *testing.T) {
	// CoolDown = 200ms
	reg := NewSurgeRegulator(0.20, 200*time.Millisecond, 3.5)

	errorMLMock := func() (float64, error) {
		return 0.0, errors.New("triton outage")
	}

	ctx := context.Background()

	// Execute 12 failures to cross totalRequests > 10 threshold
	for i := 0; i < 12; i++ {
		_ = reg.ExecuteOrFallback(ctx, errorMLMock, 10, 2)
	}

	// State should now be OPEN
	if CircuitState(reg.state) != StateOpen {
		t.Errorf("Expected circuit state to be OPEN, got %v", reg.state)
	}

	// Subsequent executes should immediately return fallback without calling ML
	called := false
	mlMock := func() (float64, error) {
		called = true
		return 1.5, nil
	}

	m := reg.ExecuteOrFallback(ctx, mlMock, 10, 2)
	if called {
		t.Error("Expected ML call to be short-circuited under OPEN state, but it was executed")
	}
	expectedFallback := reg.CalculateO1HeuristicFallback(10, 2)
	if m != expectedFallback {
		t.Errorf("Expected fallback multiplier %f, got %f", expectedFallback, m)
	}

	// Wait for cooldown to expire
	time.Sleep(250 * time.Millisecond)

	// Next execute should transition to HALF-OPEN and execute ML call (canary test)
	m2 := reg.ExecuteOrFallback(ctx, mlMock, 10, 2)
	if !called {
		t.Error("Expected ML call to run during HALF-OPEN state, but it was bypassed")
	}
	if m2 != 1.5 {
		t.Errorf("Expected canary success value 1.5, got %f", m2)
	}
	if CircuitState(reg.state) != StateHalfOpen {
		t.Errorf("Expected circuit state to be HALF-OPEN, got %v", reg.state)
	}

	// 4 more successes should transition back to CLOSED
	for i := 0; i < 4; i++ {
		_ = reg.ExecuteOrFallback(ctx, mlMock, 10, 2)
	}

	if CircuitState(reg.state) != StateClosed {
		t.Errorf("Expected circuit state to return to CLOSED, got %v", reg.state)
	}
}
