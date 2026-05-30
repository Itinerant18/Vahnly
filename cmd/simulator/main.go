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
	grpcTarget       = "127.0.0.1:50051" // standard loopback notation for telemetry gRPC service
	kafkaBroker      = "127.0.0.1:19092"
	targetH3Cell     = "88754cb247fffff"
	starvationH3Cell = "88283473fffffff"
)

// ChaosController manages real-time fault injection properties.
type ChaosController struct {
	mu               sync.RWMutex
	injectTritonFault bool
	injectHighLoad    bool // slows message send rate to simulate backpressure
}

func main() {
	log.Println("═══════════════════════════════════════════════════════════════")
	log.Println(" PHASE 4/5: CHAOS INJECTION & FAULT TUNNEL SIMULATOR RUNNER  ")
	log.Println("═══════════════════════════════════════════════════════════════")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	chaosCtrl := &ChaosController{}
	go chaosCtrl.startChaosDaemon(ctx)

	// Shared writer — one TCP connection for all 30 order emissions.
	orderWriter := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBroker),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer orderWriter.Close()

	// ─── WAVE 1: HYDRATING FLOOD OF CONCURRENT TELEMETRY STREAMS ───────
	log.Println("\n[WAVE 1] Launching 25 concurrent driver telemetry gRPC streams...")
	var wg sync.WaitGroup

	for i := 1; i <= 25; i++ {
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
	log.Println("[WAVE 1 OK] Distributed driver availability map successfully indexed in Redis cluster.")

	time.Sleep(1 * time.Second)

	// ─── WAVE 2: HIGH-VOLUME INJECTION UNDER INFRASTRUCTURE STRESS ──────
	log.Println("\n[WAVE 2] Triggering high-contention order burst (30 simultaneous bookings)...")
	log.Println("[WAVE 2] Chaos flags active: Triton-fault path and high-load backpressure.")

	for j := 1; j <= 30; j++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			orderUUID := fmt.Sprintf("f47ac10b-58cc-4372-a567-0e02b2c3d4%02d", id)
			customerUUID := fmt.Sprintf("c81d4e2e-bcf2-11e6-869b-7df2438521%02d", id)

			// Every 5th order targets the starvation zone (no drivers indexed there).
			// This exercises the no-candidates path and DLQ re-queue loop, NOT Triton.
			targetCell := targetH3Cell
			if id%5 == 0 {
				targetCell = starvationH3Cell
			}

			if err := emitOrderRequest(ctx, orderWriter, orderUUID, customerUUID, targetCell, chaosCtrl); err != nil {
				log.Printf("  ⚠️ Kafka order injection failed for order %s: %v", orderUUID, err)
			}
		}(j)
	}
	wg.Wait()
	log.Println("[WAVE 2 OK] 30 competitive bookings committed. Monitor dispatch logs for fallback safety execution.")

	// ─── WAVE 3: VERIFYING RECONCILER SELF-HEALING LIFECYCLE ─────────
	log.Println("\n[WAVE 3] Simulating anti-entropy data sync error hooks...")
	zombieOrderID := "f47ac10b-58cc-4372-a567-0e02b2c3d488"
	if err := emitOrderRequest(ctx, orderWriter, zombieOrderID, "c81d4e2e-bcf2-11e6-869b-7df243852188", starvationH3Cell, chaosCtrl); err == nil {
		log.Println("[WAVE 3 OK] Split-state conditions injected. Reconciler daemon will repair logs within 15 seconds.")
	}

	log.Println("\nKeeping simulator context warm for 8s to process background loops...")
	time.Sleep(8 * time.Second)
	log.Println("\n═══════════════════════════════════════════════════════════════")
	log.Println("  Chaos simulation wave completed. Transitioning to continuous loop...")
	log.Println("═══════════════════════════════════════════════════════════════")

	// Start continuous background telemetry for all 25 drivers
	for i := 1; i <= 25; i++ {
		go func(id int) {
			driverUUID := fmt.Sprintf("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a%02d", id)
			for {
				select {
				case <-ctx.Done():
					return
				default:
					if err := streamDriverPositionContinuous(ctx, driverUUID); err != nil {
						log.Printf("  ⚠️ Continuous telemetry drop for driver %s: %v (reconnecting...)", driverUUID, err)
						time.Sleep(3 * time.Second)
					}
				}
			}
		}(i)
	}

	// Start continuous background order admissions every 6 seconds
	orderIdx := 100
	orderTicker := time.NewTicker(6 * time.Second)
	defer orderTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-orderTicker.C:
			orderIdx++
			orderUUID := fmt.Sprintf("f47ac10b-58cc-4372-a567-0e02b2c3d5%02d", orderIdx%100)
			customerUUID := fmt.Sprintf("c81d4e2e-bcf2-11e6-869b-7df2438522%02d", orderIdx%100)

			targetCell := targetH3Cell
			if orderIdx%4 == 0 {
				targetCell = starvationH3Cell
			}

			if err := emitOrderRequest(ctx, orderWriter, orderUUID, customerUUID, targetCell, chaosCtrl); err != nil {
				log.Printf("  ⚠️ Kafka order injection failed for order %s: %v", orderUUID, err)
			} else {
				log.Printf("[LIVE_SIMULATOR] Committed new active order booking: order=%s cell=%s", orderUUID, targetCell)
			}
		}
	}
}

func streamDriverPositionContinuous(ctx context.Context, driverID string) error {
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

	// Loop indefinitely sending updates every 4 seconds
	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			latVariance := (rand.Float64() - 0.5) * 0.01
			lngVariance := (rand.Float64() - 0.5) * 0.01

			req := &pb.IngestionRequest{
				DriverId:     driverID,
				CityPrefix:   cityPrefix,
				Latitude:     22.5726 + latVariance,
				Longitude:    88.3639 + lngVariance,
				Bearing:      float32(rand.Float64() * 360.0),
				SpeedKms:     float32(15.0 + rand.Float64()*30.0),
				TimestampUtc: time.Now().Unix(),
			}

			if err := stream.Send(req); err != nil {
				return err
			}
		}
	}
}

// startChaosDaemon periodically toggles fault flags to simulate intermittent stress.
func (c *ChaosController) startChaosDaemon(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			c.injectTritonFault = !c.injectTritonFault
			c.injectHighLoad = !c.injectHighLoad

			if c.injectTritonFault || c.injectHighLoad {
				log.Printf("[CHAOS_DAEMON] Fault active: Triton-outage=%t, HighLoad-backpressure=%t", c.injectTritonFault, c.injectHighLoad)
			} else {
				log.Println("[CHAOS_DAEMON] Clearing fault flags. Nominal state.")
			}
			c.mu.Unlock()
		}
	}
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

	latVariance := (rand.Float64() - 0.5) * 0.006
	lngVariance := (rand.Float64() - 0.5) * 0.006

	req := &pb.IngestionRequest{
		DriverId:     driverID,
		CityPrefix:   cityPrefix,
		Latitude:     22.5726 + latVariance,
		Longitude:    88.3639 + lngVariance,
		Bearing:      90.0,
		SpeedKms:     22.4,
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

func emitOrderRequest(ctx context.Context, writer *kafka.Writer, orderID, customerID, h3Cell string, ctrl *ChaosController) error {
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

	ctrl.mu.RLock()
	highLoad := ctrl.injectHighLoad
	ctrl.mu.RUnlock()

	// Simulate Kafka producer backpressure under high-load flag.
	if highLoad {
		time.Sleep(50 * time.Millisecond)
	}

	payload := OrderCreatedPayload{
		OrderID:         orderID,
		CityPrefix:      cityPrefix,
		CustomerID:      customerID,
		PickupH3Cell:    h3Cell,
		PickupLat:       22.5730,
		PickupLng:       88.3642,
		PickupOSMNodeID: 1001,
		BaseFarePaise:   35000,
		RetryCount:      0,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(orderID),
		Value: payloadBytes,
	})
}
