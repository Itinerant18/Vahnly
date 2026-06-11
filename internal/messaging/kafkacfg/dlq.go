package kafkacfg

import (
	"context"
	"time"

	"github.com/segmentio/kafka-go"
)

// DLQ is a dead-letter queue producer. When a consumer hits a message it can
// never process (malformed payload, schema violation), it publishes the raw
// bytes here — with provenance headers — instead of silently dropping it or
// looping forever. Operators replay/inspect the DLQ topic out of band.
type DLQ struct {
	writer *kafka.Writer
}

// NewDLQ builds a DLQ producer for the given topic (convention: "<source>.dlq"),
// inheriting the same SASL/TLS security as the rest of the pipeline.
func NewDLQ(brokers []string, topic string, sec *Security) *DLQ {
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        topic,
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
		BatchTimeout: 10 * time.Millisecond,
	}
	if sec != nil {
		sec.ApplyToWriter(w)
	}
	return &DLQ{writer: w}
}

// Publish writes the failed message to the DLQ, preserving its key and original
// headers and tagging it with the failure reason and source topic.
func (d *DLQ) Publish(ctx context.Context, original kafka.Message, reason string) error {
	if d == nil || d.writer == nil {
		return nil
	}
	headers := append([]kafka.Header{}, original.Headers...)
	headers = append(headers,
		kafka.Header{Key: "dlq-reason", Value: []byte(reason)},
		kafka.Header{Key: "dlq-source-topic", Value: []byte(original.Topic)},
	)
	return d.writer.WriteMessages(ctx, kafka.Message{
		Key:     original.Key,
		Value:   original.Value,
		Headers: headers,
	})
}

func (d *DLQ) Close() error {
	if d == nil || d.writer == nil {
		return nil
	}
	return d.writer.Close()
}
