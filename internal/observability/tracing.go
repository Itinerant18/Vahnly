package observability

import (
	"github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
)

// GlobalTracerName isolates your microservice orchestration tracer
const GlobalTracerName = "vahnly-backbone"

// InitTracerProvider configures the global trace management structures on boot
func InitTracerProvider(serviceName string) (*sdktrace.TracerProvider, error) {
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()), // Capture 100% of marketplace allocations
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String(serviceName),
		)),
	)

	otel.SetTracerProvider(tp)
	// Enforce W3C Trace Context specification standard globally
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	return tp, nil
}

// KafkaHeaderCarrier bridges segmentio/kafka-go Headers with OpenTelemetry's TextMapCarrier interface
type KafkaHeaderCarrier struct {
	Headers *[]kafka.Header
}

// Get returns the value associated with the given key from the Kafka headers
func (c KafkaHeaderCarrier) Get(key string) string {
	for _, h := range *c.Headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

// Set stores a key-value pair inside the target Kafka header slices
func (c KafkaHeaderCarrier) Set(key string, value string) {
	for i, h := range *c.Headers {
		if h.Key == key {
			(*c.Headers)[i].Value = []byte(value)
			return
		}
	}
	*c.Headers = append(*c.Headers, kafka.Header{
		Key:   key,
		Value: []byte(value),
	})
}

// Keys returns a slice of all keys present in the carrier map
func (c KafkaHeaderCarrier) Keys() []string {
	keys := make([]string, len(*c.Headers))
	for i, h := range *c.Headers {
		keys[i] = h.Key
	}
	return keys
}
