package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/segmentio/kafka-go"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
)

type kafkaProducer struct {
	writer *kafka.Writer
}

// NewKafkaProducer instantiates an isolated Kafka connection pool for telemetry streams
func NewKafkaProducer(brokers []string) domain.KafkaProducer {
	return &kafkaProducer{
		writer: &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        "driver.location.updated", // Defined in core topology [cite: 76]
			Balancer:     &kafka.Hash{},             // Explicitly uses hashing for partition routing [cite: 76]
			MaxAttempts:  3,
			RequiredAcks: kafka.RequireOne,          // Fast sub-500ms acknowledgment path [cite: 2]
			Async:        true,                      // Non-blocking asynchronous ingestion path [cite: 34]
		},
	}
}

func (p *kafkaProducer) PublishLocationUpdate(ctx context.Context, loc *domain.DriverLocation) error {
	// Serialize domain struct to JSON payload bytes
	payload, err := json.Marshal(loc)
	if err != nil {
		return fmt.Errorf("failed to serialize telemetry payload: %w", err)
	}

	// Route event dynamically based on city prefix partition key [cite: 74, 76]
	msg := kafka.Message{
		Key:   []byte(loc.CityPrefix), 
		Value: payload,
	}

	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		return fmt.Errorf("kafka streaming partition write failed: %w", err)
	}

	return nil
}

// Close gracefully flushes trailing batched network messages to brokers
func (p *kafkaProducer) Close() error {
	return p.writer.Close()
}
