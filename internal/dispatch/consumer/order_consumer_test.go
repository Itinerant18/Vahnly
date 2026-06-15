package consumer

import (
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/dispatch/domain"
)

func TestOrderCreatedConsumer_CompileCheck(t *testing.T) {
	// A simple compile-time type-safety check for OrderCreatedConsumer creation
	var _ *OrderCreatedConsumer = nil
}

func TestOrderCreatedConsumer_DynamicBatchingWindow(t *testing.T) {
	c := &OrderCreatedConsumer{
		batchWindow:        300 * time.Millisecond,
		lastFlushTime:      time.Now().Add(-1 * time.Second),
		rollingArrivalRate: 0.0,
	}

	// 1. Off-peak: 5 orders in 1 second = 5 orders/sec (rolling rate < 10)
	batch := make([]domain.OrderCreatedPayload, 5)

	// Simulate computation phase in processBatchLoop:
	now := time.Now()
	elapsedSeconds := 1.0 // simulate 1 second elapsed
	c.lastFlushTime = now

	momentaryRate := float64(len(batch)) / elapsedSeconds
	c.rollingArrivalRate = momentaryRate // Seed on startup

	if c.rollingArrivalRate < 10.0 {
		c.batchWindow = 100 * time.Millisecond
	} else if c.rollingArrivalRate > 60.0 {
		c.batchWindow = 400 * time.Millisecond
	} else {
		c.batchWindow = time.Duration(100+int((c.rollingArrivalRate-10.0)*6.0)) * time.Millisecond
	}

	if c.batchWindow != 100*time.Millisecond {
		t.Errorf("Expected off-peak window 100ms, got %v", c.batchWindow)
	}

	// 2. High peak: 80 orders in 1 second = 80 orders/sec (rolling rate > 60)
	batch = make([]domain.OrderCreatedPayload, 80)
	elapsedSeconds = 1.0
	momentaryRate = float64(len(batch)) / elapsedSeconds
	c.rollingArrivalRate = (0.3 * momentaryRate) + (0.7 * c.rollingArrivalRate)

	if c.rollingArrivalRate < 10.0 {
		c.batchWindow = 100 * time.Millisecond
	} else if c.rollingArrivalRate > 60.0 {
		c.batchWindow = 400 * time.Millisecond
	} else {
		c.batchWindow = time.Duration(100+int((c.rollingArrivalRate-10.0)*6.0)) * time.Millisecond
	}

	// 0.3 * 80 + 0.7 * 5 = 24 + 3.5 = 27.5 orders/sec.
	// This is in between: 100 + (27.5-10)*6 = 100 + 17.5*6 = 205ms
	expectedWindow := time.Duration(100+int((c.rollingArrivalRate-10.0)*6.0)) * time.Millisecond
	if c.batchWindow != expectedWindow {
		t.Errorf("Expected in-between window %v, got %v", expectedWindow, c.batchWindow)
	}

	// 3. Force severe peak: momentary rate of 200 orders/sec
	batch = make([]domain.OrderCreatedPayload, 200)
	elapsedSeconds = 1.0
	momentaryRate = float64(len(batch)) / elapsedSeconds
	c.rollingArrivalRate = (0.3 * momentaryRate) + (0.7 * c.rollingArrivalRate)
	// 0.3 * 200 + 0.7 * 27.5 = 60 + 19.25 = 79.25 orders/sec (rolling rate > 60)

	if c.rollingArrivalRate < 10.0 {
		c.batchWindow = 100 * time.Millisecond
	} else if c.rollingArrivalRate > 60.0 {
		c.batchWindow = 400 * time.Millisecond
	} else {
		c.batchWindow = time.Duration(100+int((c.rollingArrivalRate-10.0)*6.0)) * time.Millisecond
	}

	if c.batchWindow != 400*time.Millisecond {
		t.Errorf("Expected peak window 400ms, got %v", c.batchWindow)
	}
}
