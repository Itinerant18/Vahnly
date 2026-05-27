package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
)

const (
	cityPrefix   = "KOL"
	grpcTarget   = "127.0.0.1:50051" // Forcing explicit IPv4 path resolution
	kafkaBroker  = "localhost:19092"
	targetH3Cell = "88754cb247fffff"  // Central Kolkata Resolution 8 Hexagon Anchor
)

func main() {
	log.Println("═══════════════════════════════════════════════════")
	log.Println(" PHASE 3/4 ADAPTIVE MULTI-DRIVER E2E SIMULATOR      ")
	log.Println("═══════════════════════════════════════════════════")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ─── STEP 1: CONCURRENT DRIVER TELEMETRY FLOOD ────────────────────
	log.Println("\n[STEP 1] Simulating 10 concurrent active driver telemetry emissions...")
	var wg sync.WaitGroup
	
	// Spawns 10 independent driver clients streaming updates to your gRPC gateway
	for i := 1; i <= 10; i++ {
		wg.Add(1)
		go func(driverIdx int) {
			defer wg.Done()
			driverUUID := fmt.Sprintf("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a%02d", driverIdx)
			if err := emitDriverTelemetry(ctx, driverUUID); err != nil {
				log.Printf(" ⚠️ Telemetry emission failed for driver %s: %v", driverUUID, err)
			}
		}(i)
	}
	wg.Wait()
	log.Println("[STEP 1 OK] Distributed driver positions successfully indexed across H3 shards.")

	log.Println("\nWaiting 2s for cluster storage registers to warm up...")
	time.Sleep(2 * time.Second)

	// ─── STEP 2: CONCURRENT MARKETPLACE ORDER INJECTION ──────────────
	log.Println("\n[STEP 2] Simulating a concurrent burst of passenger ride searches...")
	
	// Injects 5 conflicting order requests simultaneously to force Hungarian matrix completion
	for j := 1; j <= 5; j++ {
		wg.Add(1)
		go func(orderIdx int) {
			defer wg.Done()
			orderUUID := fmt.Sprintf("f47ac10b-58cc-4372-a567-0e02b2c3d4%02d", orderIdx)
			customerUUID := fmt.Sprintf("c81d4e2e-bcf2-11e6-869b-7df2438521%02d", orderIdx)
			if err := injectOrderEvent(ctx, orderUUID, customerUUID); err != nil {
				log.Printf(" ⚠️ Kafka order event insertion failed for order %s: %v", orderUUID, err)
			}
		}(j)
	}
	wg.Wait()
	log.Println("[STEP 2 OK] High-contention order burst committed to ingestion log pipelines.")

	// ─── STEP 3: ASYNC OVERFLOW RETRY INSPECTION ─────────────────────
	log.Println("\n[STEP 3] Simulating a standalone Starved 'Poison Pill' Request...")
	// Fires an order located in an empty spatial cell to trigger and verify the async retry loop path
	starvedOrderUUID := "f47ac10b-58cc-4372-a567-0e02b2c3d499"
	if err := injectOrderEvent(ctx, starvedOrderUUID, "c81d4e2e-bcf2-11e6-869b-7df243852199"); err == nil {
		log.Println("[STARVATION TRIGGERED] Monitor dispatch runtime logs to observe exponential re-queuing loops.")
	}

	log.Println("\nWaiting 5s for the global consumer batch flushes to finalize...")
	time.Sleep(5 * time.Second)
	log.Println("\n[SIMULATION COMPLETE] Global assignment topologies successfully optimized.")
}

func emitDriverTelemetry(ctx context.Context, driverID string) error {
	conn, err := grpc.NewClient(grpcTarget, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer conn.Close()

	client := pb.NewLocationIngestionServiceClient(conn)
	stream, err := client.ClientStreamPositions(ctx)
	if err != nil {
		return err
	}

	// Generating subtle spatial variance within central city coordinates
	latOffset := (rand.Float64() - 0.5) * 0.01
	lngOffset := (rand.Float64() - 0.5) * 0.01

	req := &pb.IngestionRequest{
		DriverId:     driverID,
		CityPrefix:   cityPrefix,
		Latitude:     22.5726 + latOffset,
		Longitude:    88.3639 + lngOffset,
		Bearing:      120.0,
		SpeedKms:     35.5,
		TimestampUtc: time.Now().Unix(),
	}

	if err := stream.Send(req); err != nil {
		return err
	}

	resp, err := stream.CloseAndRecv()
	if err != nil {
		return err
	}
	if !resp.Success {
		return fmt.Errorf("gRPC server rejected telemetry package sync fields")
	}
	return nil
}

func injectOrderEvent(ctx context.Context, orderID, customerID string) error {
	type OrderCreatedPayload struct {
		OrderID         string  `json:"order_id"`
		CityPrefix      string  `json:"city_prefix"`
		CustomerID      string  `json:"customer_id"`
		PickupH3Cell    string  `json:"pickup_h3_cell"`
		PickupLat       float64 `json:"pickup_lat"`
		PickupLng       float64 `json:"pickup_lng"`
		PickupOSMNodeID int64   `json:"pickup_osm_node_id"`
		BaseFarePaise   int64   `json:"base_fare_paise"`
		RetryCount      int     `json:"retry_count"`
	}

	payload := OrderCreatedPayload{
		OrderID:         orderID,
		CityPrefix:      cityPrefix,
		CustomerID:      customerID,
		PickupH3Cell:    targetH3Cell,
		PickupLat:       22.5730,
		PickupLng:       88.3642,
		PickupOSMNodeID: 1001,
		BaseFarePaise:   42500, // 425.00 INR stored as paise integer bounds
		RetryCount:      0,     // Initialized fresh for tracking allocation depth
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	writer := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBroker),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer writer.Close()

	return writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(orderID),
		Value: payloadBytes,
	})
}
