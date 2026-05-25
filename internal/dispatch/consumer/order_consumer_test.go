package consumer_test

import (
	"testing"

	"github.com/platform/driver-delivery/internal/dispatch/consumer"
)

func TestOrderCreatedConsumer_CompileCheck(t *testing.T) {
	// A simple compile-time type-safety check for OrderCreatedConsumer creation
	var _ *consumer.OrderCreatedConsumer = nil
}
