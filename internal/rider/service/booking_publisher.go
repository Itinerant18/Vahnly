package service

import (
	"context"
	"time"

	"github.com/segmentio/kafka-go"

	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
)

// KafkaEventPublisher publishes booking lifecycle events to per-message topics.
// The writer has no fixed Topic, so each Publish targets its own topic.
type KafkaEventPublisher struct {
	w *kafka.Writer
}

func NewKafkaEventPublisher(brokers []string) *KafkaEventPublisher {
	sec := kafkacfg.FromEnv()
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
		// Request-path producer: flush immediately so the booking handler never
		// blocks on the default 1s batch timeout.
		BatchTimeout: 10 * time.Millisecond,
		BatchSize:    1,
	}
	sec.ApplyToWriter(w)
	return &KafkaEventPublisher{w: w}
}

func (p *KafkaEventPublisher) Publish(ctx context.Context, topic, key string, value []byte) error {
	return p.w.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: value,
	})
}

func (p *KafkaEventPublisher) Close() error { return p.w.Close() }
