package observability

import (
	"context"
	"testing"

	"github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
)

func TestInitTracerProvider(t *testing.T) {
	tp, err := InitTracerProvider("test-service")
	if err != nil {
		t.Fatalf("Failed to initialize TracerProvider: %v", err)
	}
	if tp == nil {
		t.Fatal("Expected TracerProvider to be non-nil")
	}
	defer func() { _ = tp.Shutdown(context.Background()) }()

	// Assert global tracer provider and propagator are set
	if otel.GetTracerProvider() != tp {
		t.Error("Expected global TracerProvider to be set")
	}
	if otel.GetTextMapPropagator() == nil {
		t.Error("Expected global TextMapPropagator to be configured")
	}
}

func TestKafkaHeaderCarrier(t *testing.T) {
	headers := []kafka.Header{
		{Key: "existing-key", Value: []byte("existing-value")},
	}
	carrier := KafkaHeaderCarrier{Headers: &headers}

	// 1. Get existing key
	if val := carrier.Get("existing-key"); val != "existing-value" {
		t.Errorf("Expected 'existing-value', got '%s'", val)
	}

	// 2. Get non-existent key
	if val := carrier.Get("missing-key"); val != "" {
		t.Errorf("Expected empty string, got '%s'", val)
	}

	// 3. Set existing key
	carrier.Set("existing-key", "updated-value")
	if val := carrier.Get("existing-key"); val != "updated-value" {
		t.Errorf("Expected 'updated-value', got '%s'", val)
	}

	// 4. Set new key
	carrier.Set("new-key", "new-value")
	if val := carrier.Get("new-key"); val != "new-value" {
		t.Errorf("Expected 'new-value', got '%s'", val)
	}

	// 5. Verify Keys collection
	keys := carrier.Keys()
	if len(keys) != 2 {
		t.Fatalf("Expected 2 keys, got %d", len(keys))
	}
	if keys[0] != "existing-key" || keys[1] != "new-key" {
		t.Errorf("Unexpected keys list: %v", keys)
	}
}
