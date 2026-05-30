package surge

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

type CircuitState int32

const (
	StateClosed CircuitState = iota
	StateOpen
	StateHalfOpen
)

type SurgeRegulator struct {
	sync.RWMutex
	state              int32 // Atomic CircuitState
	failureCount       int64
	consecutiveSuccess int64
	totalRequests      int64
	lastStateChange    time.Time
	
	maxTimeout       time.Duration
	failureThreshold float64 // Percentage e.g. 0.20
	coolDownPeriod   time.Duration
	alphaCoefficient float64 // Heuristic pricing amplifier
	maxSurgeLimit    float64 // Maximum cap multiplier e.g. 3.5
}

func NewSurgeRegulator(failureThreshold float64, coolDown time.Duration, maxSurge float64) *SurgeRegulator {
	return &SurgeRegulator{
		state:            int32(StateClosed),
		maxTimeout:       30 * time.Millisecond,
		failureThreshold: failureThreshold,
		coolDownPeriod:   coolDown,
		alphaCoefficient: 0.45,
		maxSurgeLimit:    maxSurge,
		lastStateChange:  time.Now(),
	}
}

// ExecuteOrFallback wraps ML inference blocks, intercepting pings exceeding 30ms bounds
func (r *SurgeRegulator) ExecuteOrFallback(ctx context.Context, mlCall func() (float64, error), demand, supply int64) float64 {
	currentState := CircuitState(atomic.LoadInt32(&r.state))

	// 1. Evaluate open circuit condition lifecycle states
	if currentState == StateOpen {
		if time.Since(r.getStateChangeTime()) > r.coolDownPeriod {
			// Transition to Half-Open to canary test system recovery metrics
			atomic.StoreInt32(&r.state, int32(StateHalfOpen))
		} else {
			return r.CalculateO1HeuristicFallback(demand, supply)
		}
	}

	atomic.AddInt64(&r.totalRequests, 1)
	startTime := time.Now()

	// Execute ML target client call within a rigorous local 30ms context boundary
	execCtx, cancel := context.WithTimeout(ctx, r.maxTimeout)
	defer cancel()

	type resultTuple struct {
		multiplier float64
		err        error
	}
	resChan := make(chan resultTuple, 1)

	go func() {
		m, err := mlCall()
		resChan <- resultTuple{multiplier: m, err: err}
	}()

	select {
	case <-execCtx.Done():
		// Context boundary breached (Timeout > 30ms) or cancelled
		r.recordFailure()
		return r.CalculateO1HeuristicFallback(demand, supply)

	case res := <-resChan:
		if res.err != nil || time.Since(startTime) > r.maxTimeout {
			r.recordFailure()
			return r.CalculateO1HeuristicFallback(demand, supply)
		}

		r.recordSuccess()
		return res.multiplier
	}
}

func (r *SurgeRegulator) CalculateO1HeuristicFallback(demand, supply int64) float64 {
	// O(1) Mathematical Fallback Formulations avoiding floating point segmentation panic flags
	if demand <= supply {
		return 1.0
	}
	
	// Multiplier = 1.0 + alpha * ln((Demand+1)/(Supply+1))
	ratio := float64(demand+1) / float64(supply+1)
	multiplier := 1.0 + r.alphaCoefficient*math.Log(ratio)

	if multiplier > r.maxSurgeLimit {
		return r.maxSurgeLimit
	}
	return multiplier
}

func (r *SurgeRegulator) recordFailure() {
	atomic.AddInt64(&r.failureCount, 1)
	atomic.StoreInt64(&r.consecutiveSuccess, 0)

	total := float64(atomic.LoadInt64(&r.totalRequests))
	fails := float64(atomic.LoadInt64(&r.failureCount))

	if total > 10 && (fails/total) >= r.failureThreshold {
		r.Lock()
		if atomic.LoadInt32(&r.state) != int32(StateOpen) {
			atomic.StoreInt32(&r.state, int32(StateOpen))
			r.lastStateChange = time.Now()
		}
		r.Unlock()
	}
}

func (r *SurgeRegulator) recordSuccess() {
	if CircuitState(atomic.LoadInt32(&r.state)) == StateHalfOpen {
		successes := atomic.AddInt64(&r.consecutiveSuccess, 1)
		if successes >= 5 {
			r.Lock()
			atomic.StoreInt32(&r.state, int32(StateClosed))
			atomic.StoreInt64(&r.failureCount, 0)
			atomic.StoreInt64(&r.totalRequests, 0)
			r.Unlock()
		}
	}
}

func (r *SurgeRegulator) getStateChangeTime() time.Time {
	r.RLock()
	defer r.RUnlock()
	return r.lastStateChange
}
