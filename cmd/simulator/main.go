// cmd/simulator/main.go
//
// Local E2E Smoke Test Simulator
// ================================
// Phase 1: Sends a gRPC telemetry stream for driver a0eebc99-...
//           → gRPC handler → H3 indexing → Redis ZSET (drivers:zset:{KOL}:88283473fffffff)
//           → Kafka async publish → driver.location.updated
//
// Phase 2: Publishes an OrderCreatedPayload directly to order.created Kafka topic
//           → OrderCreatedConsumer → SpatialScanner (Redis ZSET lookup)
//           → EvaluateGreedyMatch → commitAssignmentTransaction (PostgreSQL)
//           → emitAssignedEvent → order.assigned Kafka topic
//
// Run: go run cmd/simulator/main.go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
)

// Seeded UUIDs — must exactly match seed_test_data.sql
const (
	seededDriverID    = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	seededOrderID     = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
	seededCustomerID  = "c81d4e2e-bcf2-11e6-869b-7df243852131"
	seededH3Cell      = "88754cb247fffff" // Resolution 8 cell for Central Kolkata
	cityPrefix        = "KOL"
	grpcTarget        = "localhost:50051"
	kafkaBroker       = "localhost:19092"
)

func main() {
	log.Println("═══════════════════════════════════════════════════")
	log.Println("  Local E2E Smoke Test — Dispatch Pipeline")
	log.Println("═══════════════════════════════════════════════════")

	// ─── Phase 1: Push driver telemetry via gRPC stream ─────────────────────
	log.Println("\n[Phase 1] Sending driver location telemetry via gRPC stream...")
	if err := runGRPCTelemetry(); err != nil {
		log.Fatalf("[Phase 1 FAILED] %v", err)
	}
	log.Println("[Phase 1 OK] Driver indexed into Redis H3 ZSET.")

	// Give the async Redis write a moment to propagate before the consumer reads
	log.Println("\nWaiting 2s for Redis ZSET write to propagate...")
	time.Sleep(2 * time.Second)

	// ─── Phase 2: Publish order.created event to trigger the batch matcher ──
	log.Println("\n[Phase 2] Publishing OrderCreatedPayload to order.created Kafka topic...")
	if err := runOrderCreatedEvent(); err != nil {
		log.Fatalf("[Phase 2 FAILED] %v", err)
	}
	log.Println("[Phase 2 OK] order.created event published to Kafka.")
	log.Println("\nWaiting 5s for batch matcher window (300ms) + DB commit...")
	time.Sleep(5 * time.Second)

	log.Println("\n═══════════════════════════════════════════════════")
	log.Println("  Simulator complete. Verify DB state with:")
	log.Println("  SELECT id, status, assigned_driver_id, assigned_at")
	log.Println("  FROM orders WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';")
	log.Println("═══════════════════════════════════════════════════")
}

// runGRPCTelemetry opens a client-streaming gRPC channel to the ingestion service,
// sends one IngestionRequest for our seeded driver, and closes the stream.
func runGRPCTelemetry() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(grpcTarget,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return fmt.Errorf("gRPC dial failed: %w", err)
	}
	defer conn.Close()

	client := pb.NewLocationIngestionServiceClient(conn)

	stream, err := client.ClientStreamPositions(ctx)
	if err != nil {
		return fmt.Errorf("gRPC stream open failed: %w", err)
	}

	// IngestionRequest — field names from telemetry.pb.go, NOT DriverPositionUpdate
	req := &pb.IngestionRequest{
		DriverId:     seededDriverID,
		CityPrefix:   cityPrefix,
		Latitude:     22.5726, // Central Kolkata — handler converts to radians internally
		Longitude:    88.3639,
		Bearing:      180.5,
		SpeedKms:     22.4,
		TimestampUtc: time.Now().Unix(),
	}

	log.Printf("  Sending: driver=%s lat=%.4f lng=%.4f city=%s",
		req.DriverId, req.Latitude, req.Longitude, req.CityPrefix)

	if err := stream.Send(req); err != nil {
		return fmt.Errorf("stream.Send failed: %w", err)
	}

	resp, err := stream.CloseAndRecv()
	if err != nil {
		return fmt.Errorf("stream.CloseAndRecv failed: %w", err)
	}

	if !resp.Success {
		return fmt.Errorf("server returned success=false")
	}

	log.Printf("  Server confirmed: success=%v recorded_at=%d", resp.Success, resp.RecordedAt)
	return nil
}

// runOrderCreatedEvent publishes the exact OrderCreatedPayload JSON structure
// that OrderCreatedConsumer.StartExecutionPipeline() expects on the order.created topic.
// See: internal/dispatch/consumer/order_consumer.go → json.Unmarshal(msg.Value, &order)
// See: internal/dispatch/domain/models.go → OrderCreatedPayload
func runOrderCreatedEvent() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	type OrderCreatedPayload struct {
		OrderID         string  `json:"order_id"`
		CityPrefix      string  `json:"city_prefix"`
		CustomerID      string  `json:"customer_id"`
		PickupH3Cell    string  `json:"pickup_h3_cell"`
		PickupLat       float64 `json:"pickup_lat"`
		PickupLng       float64 `json:"pickup_lng"`
		PickupOSMNodeID int64   `json:"pickup_osm_node_id"`
		BaseFarePaise   int64   `json:"base_fare_paise"`
	}

	payload := OrderCreatedPayload{
		OrderID:         seededOrderID,
		CityPrefix:      cityPrefix,
		CustomerID:      seededCustomerID,
		PickupH3Cell:    seededH3Cell,
		PickupLat:       22.5730,
		PickupLng:       88.3642,
		PickupOSMNodeID: 1001, // SpatialScanner seeds OSMNodeID=1001 for all candidates
		BaseFarePaise:   35000,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("json.Marshal failed: %w", err)
	}

	writer := kafka.NewWriter(kafka.WriterConfig{
		Brokers:      []string{kafkaBroker},
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: 1,
	})
	defer writer.Close()

	msg := kafka.Message{
		Key:   []byte(seededOrderID),
		Value: payloadBytes,
	}

	log.Printf("  Publishing to order.created: order=%s h3=%s fare=%d paise",
		payload.OrderID, payload.PickupH3Cell, payload.BaseFarePaise)

	if err := writer.WriteMessages(ctx, msg); err != nil {
		return fmt.Errorf("kafka WriteMessages failed: %w", err)
	}

	log.Printf("  Message delivered to order.created partition.")
	return nil
}
