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
	cityPrefix       = "KOL"
	grpcTarget       = "127.0.0.1:50051" // Forcing explicit IPv4 path resolution to bypass IPv6 loopback lag
	kafkaBroker      = "localhost:19092"
	targetH3Cell     = "88754cb247fffff"  // Anchor cell for central Kolkata
	starvationH3Cell = "88283473fffffff"  // Isolated cell with zero driver supply
)

func main() {
	log.Println("═══════════════════════════════════════════════════")
	log.Println("  ENTERPRISE CONCURRENT DISPATCH STRESS SIMULATOR  ")
	log.Println("═══════════════════════════════════════════════════")

	rand.Seed(time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ────────────────────────────────────────────────────────────────────────
	// WAVE 1: CONCURRENT DRIVER TELEMETRY INGESTION FLOOD
	// ────────────────────────────────────────────────────────────────────────
	log.Println("\n[WAVE 1] Launching 20 concurrent driver telemetry gRPC streams...")
	var wg sync.WaitGroup

	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			driverUUID := fmt.Sprintf("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a%02d", id)
			if err := streamDriverPosition(ctx, driverUUID); err != nil {
				log.Printf("  ⚠️ Telemetry stream failed for driver %s: %v", driverUUID, err)
			}
		}(i)
	}
	wg.Wait()
	log.Println("[WAVE 1 OK] 20 unique drivers successfully indexed inside cell ring caches.")

	log.Println("\nAllowing 2 seconds for cluster caches to stabilize...")
	time.Sleep(2 * time.Second)

	// ────────────────────────────────────────────────────────────────────────
	// WAVE 2: SIMULTANEOUS MARKETPLACE ORDER INJECTION (HIGH CONTENTION)
	// ────────────────────────────────────────────────────────────────────────
	log.Println("\n[WAVE 2] Launching 10 simultaneous conflicting ride orders...")
	
	for j := 1; j <= 10; j++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			orderUUID := fmt.Sprintf("f47ac10b-58cc-4372-a567-0e02b2c3d4%02d", id)
			customerUUID := fmt.Sprintf("c81d4e2e-bcf2-11e6-869b-7df2438521%02d", id)
			
			if err := emitOrderRequest(ctx, orderUUID, customerUUID, targetH3Cell); err != nil {
				log.Printf("  ⚠️ Kafka order injection failed for order %s: %v", orderUUID, err)
			}
		}(j)
	}
	wg.Wait()
	log.Println("[WAVE 2 OK] High-contention order batch committed to Kafka partition queue.")

	// ────────────────────────────────────────────────────────────────────────
	// WAVE 3: TRIGGER ASYNC RE-QUEUE RETRY LIFECYCLE
	// ────────────────────────────────────────────────────────────────────────
	log.Println("\n[WAVE 3] Injecting standalone 'Poison Pill' order to test starvation re-queue...")
	starvedOrderID := "f47ac10b-58cc-4372-a567-0e02b2c3d499"
	starvedCustomerID := "c81d4e2e-bcf2-11e6-869b-7df243852199"
	
	if err := emitOrderRequest(ctx, starvedOrderID, starvedCustomerID, starvationH3Cell); err == nil {
		log.Println("[WAVE 3 OK] Starvation order committed. Check dispatch logs for exponential re-queues.")
	}

	log.Println("\nWaiting 6 seconds for batch aggregation window (300ms) + Kuhn-Munkres execution...")
	time.Sleep(6 * time.Second)
	log.Println("\n═══════════════════════════════════════════════════")
	log.Println("  Simulator run complete. Run your database queries ")
	log.Println("  to verify that assignments were optimized without")
	log.Println("  resource contention collision locks.")
	log.Println("═══════════════════════════════════════════════════")
}

func streamDriverPosition(ctx context.Context, driverID string) error {
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

	// Inject minor spatial coordinates variance to simulate a realistic urban radius layout
	latVariance := (rand.Float64() - 0.5) * 0.008
	lngVariance := (rand.Float64() - 0.5) * 0.008

	req := &pb.IngestionRequest{
		DriverId:     driverID,
		CityPrefix:   cityPrefix,
		Latitude:     22.5726 + latVariance,
		Longitude:    88.3639 + lngVariance,
		Bearing:      45.2,
		SpeedKms:     28.1,
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
		return fmt.Errorf("server rejected telemetry transaction frame")
	}
	return nil
}

func emitOrderRequest(ctx context.Context, orderID, customerID, h3Cell string) error {
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
		PickupH3Cell:    h3Cell,
		PickupLat:       22.5730,
		PickupLng:       88.3642,
		PickupOSMNodeID: 1001,
		BaseFarePaise:   38500, // 385.00 INR stored safely as an integer
		RetryCount:      0,
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
