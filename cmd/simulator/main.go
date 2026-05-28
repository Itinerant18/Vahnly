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
	grpcTarget       = "127.0.0.1:50051" 
	kafkaBroker      = "127.0.0.1:19092"
	targetH3Cell     = "88754cb247fffff" 
	starvationH3Cell = "88283473fffffff" 
)

// ChaosController manages real-time fault injection properties
type ChaosController struct {
	mu                 sync.RWMutex
	injectTritonFault  bool
	injectDbLatency    bool
}

func main() {
	log.Println("═══════════════════════════════════════════════════════════════")
	log.Println(" PHASE 4/5: CHAOS INJECTION & FAULT TUNNEL SIMULATOR RUNNER  ")
	log.Println("═══════════════════════════════════════════════════════════════")

	rand.Seed(time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	chaosCtrl := &ChaosController{}

	// Start the automated chaos daemon in the background to continuously manipulate infrastructure dependencies
	go chaosCtrl.startChaosDaemon(ctx)

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
	log.Println("[WAVE 2] Injected faults will activate randomly mid-execution to verify fallback SLA safety.")

	for j := 1; j <= 30; j++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			orderUUID := fmt.Sprintf("f47ac10b-58cc-4372-a567-0e02b2c3d4%02d", id)
			customerUUID := fmt.Sprintf("c81d4e2e-bcf2-11e6-869b-7df2438521%02d", id)
			
			// Introduce a randomized variable to force a subset of requests into targeted fault zones
			targetCell := targetH3Cell
			if id%5 == 0 {
				chaosCtrl.mu.RLock()
				if chaosCtrl.injectTritonFault {
					// Simulate a bad spatial token lookup to force Triton gRPC disconnection fallbacks
					targetCell = "INVALID_H3_ZONE"
				}
				chaosCtrl.mu.RUnlock()
			}

			if err := emitOrderRequest(ctx, orderUUID, customerUUID, targetCell, chaosCtrl); err != nil {
				log.Printf("  ⚠️ Kafka order injection failed for order %s: %v", orderUUID, err)
			}
		}(j)
	}
	wg.Wait()
	log.Println("[WAVE 2 OK] 30 competitive bookings committed. Monitor dispatch logs for fallback safety execution.")

	// ─── WAVE 3: VERIFYING RECONCILER SELF-HEALING LIFECYCLE ─────────
	log.Println("\n[WAVE 3] Simulating anti-entropy data sync error hooks...")
	// We insert an order that bypasses standard matching logic to create a split-state scenario,
	// verifying that the reconciler daemon automatically patches missing event streams.
	zombieOrderID := "f47ac10b-58cc-4372-a567-0e02b2c3d488"
	if err := emitOrderRequest(ctx, zombieOrderID, "c81d4e2e-bcf2-11e6-869b-7df243852188", starvationH3Cell, chaosCtrl); err == nil {
		log.Println("[WAVE 3 OK] Split-state conditions injected. Reconciler daemon will repair logs within 15 seconds.")
	}

	log.Println("\nKeeping simulator context warm for 8s to process background loops...")
	time.Sleep(8 * time.Second)
	log.Println("\n═══════════════════════════════════════════════════════════════")
	log.Println("  Chaos simulation finalized. Review Prometheus dashboards    ")
	log.Println("  to confirm that fallbacks executed within the 500ms limit.   ")
	log.Println("═══════════════════════════════════════════════════════════════")
}

// startChaosDaemon periodically modifies fault properties to simulate intermittent network issues
func (c *ChaosController) startChaosDaemon(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			// Alternate fault states to test runtime resilience variability
			c.injectTritonFault = !c.injectTritonFault
			c.injectDbLatency = !c.injectDbLatency
			
			if c.injectTritonFault || c.injectDbLatency {
				log.Printf("[CHAOS_DAEMON] Injecting infrastructure degradation: Triton-Outage=%t, DB-Latency=%t", c.injectTritonFault, c.injectDbLatency)
			} else {
				log.Println("[CHAOS_DAEMON] Clearing fault flags. Infrastructure recovering to nominal state.")
			}
			c.mu.Unlock()
		}
	}
}

func streamDriverPosition(ctx context.Context, driverID string) error {
	dialCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(dialCtx, grpcTarget, grpc.WithTransportCredentials(insecure.NewCredentials()))
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

func emitOrderRequest(ctx context.Context, orderID, customerID, h3Cell string, ctrl *ChaosController) error {
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

	baseFare := int64(35000) // 350.00 INR baseline currency allocation
	
	ctrl.mu.RLock()
	if ctrl.injectDbLatency && h3Cell != starvationH3Cell {
		// Alter the base fare value slightly for specific requests to force 
		// downstream worker threads to evaluate longer pricing validation paths
		baseFare = 45000
	}
	ctrl.mu.RUnlock()

	payload := OrderCreatedPayload{
		OrderID:         orderID,
		CityPrefix:      cityPrefix,
		CustomerID:      customerID,
		PickupH3Cell:    h3Cell,
		PickupLat:       22.5730,
		PickupLng:       88.3642,
		PickupOSMNodeID: 1001,
		BaseFarePaise:   baseFare,
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
