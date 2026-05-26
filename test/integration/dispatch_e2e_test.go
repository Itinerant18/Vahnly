//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/platform/driver-delivery/internal/dispatch/consumer"
	dispatchRepo "github.com/platform/driver-delivery/internal/dispatch/repository"
	"github.com/platform/driver-delivery/internal/routing/graph"
	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
	grpcDelivery "github.com/platform/driver-delivery/internal/telemetry/delivery/grpc"
	telemetryRepo "github.com/platform/driver-delivery/internal/telemetry/repository"
	telemetryUsecase "github.com/platform/driver-delivery/internal/telemetry/usecase"
	intelligenceUsecase "github.com/platform/driver-delivery/internal/intelligence/usecase"
)

type simpleRoutingService struct {
	chService *graph.ContractionHierarchiesService
}

func (s *simpleRoutingService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	return s.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
}

func TestE2E_TelemetryAndDispatchPipeline(t *testing.T) {
	postgresURL := os.Getenv("DATABASE_URL")
	redisNodes := os.Getenv("REDIS_CLUSTER_NODES")
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	redisIPMap := os.Getenv("REDIS_IP_MAP")

	if postgresURL == "" || redisNodes == "" || kafkaBrokers == "" {
		t.Skip("Skipping integration test: environment variables DATABASE_URL, REDIS_CLUSTER_NODES, and KAFKA_BROKERS must be set.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 1. Initialize PostgreSQL pool
	pgxConfig, err := pgxpool.ParseConfig(postgresURL)
	if err != nil {
		t.Fatalf("Parse PostgreSQL config failed: %v", err)
	}
	dbPool, err := pgxpool.NewWithConfig(ctx, pgxConfig)
	if err != nil {
		t.Fatalf("Connect PostgreSQL failed: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		t.Fatalf("Ping PostgreSQL failed: %v", err)
	}

	// 2. Initialize Redis Cluster Client
	ipMap := make(map[string]string)
	if redisIPMap != "" {
		for _, pair := range strings.Split(redisIPMap, ",") {
			parts := strings.Split(pair, "=")
			if len(parts) == 2 {
				ipMap[parts[0]] = parts[1]
			}
		}
	}

	redisClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: strings.Split(redisNodes, ","),
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if localAddr, ok := ipMap[addr]; ok {
				addr = localAddr
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, addr)
		},
	})
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Fatalf("Ping Redis Cluster failed: %v", err)
	}

	// 3. Clear and seed PostgreSQL Database
	t.Log("Seeding PostgreSQL...")
	seedSQL := []string{
		"DELETE FROM dispatch_match_logs WHERE order_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'",
		"DELETE FROM orders WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'",
		"DELETE FROM drivers WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'",
		"DELETE FROM regional_cities WHERE city_prefix = 'KOL'",
		`INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active, geofence)
		 VALUES ('KOL', 'Kolkata', 'Asia/Kolkata', true, ST_GeomFromText('MULTIPOLYGON(((88.3 22.5, 88.4 22.5, 88.4 22.6, 88.3 22.6, 88.3 22.5)))', 4326)::geography)`,
		`INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, acceptance_rate, cancellation_rate)
		 VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'KOL', 'Subir Das', '+919876543210', 'DL-12345-KOL', 'ONLINE_AVAILABLE', true, 0.950, 0.010)`,
		`INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, surge_multiplier, base_fare_paise)
		 VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'KOL', 'c81d4e2e-bcf2-11e6-869b-7df243852131', 'CREATED', ST_GeomFromText('POINT(88.3639 22.5726)', 4326)::geography, ST_GeomFromText('POINT(88.3700 22.5800)', 4326)::geography, '88754cb247fffff', 1.00, 35000)`,
	}
	for _, query := range seedSQL {
		if _, err := dbPool.Exec(ctx, query); err != nil {
			t.Fatalf("Failed to execute query %q: %v", query, err)
		}
	}

	// 4. Seed Redis Cluster Driver Profile
	t.Log("Seeding Redis driver profile...")
	profileKey := "driver:{KOL}:profile:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	err = redisClient.HSet(ctx, profileKey, map[string]interface{}{
		"osm_node_id":              "1001",
		"acceptance_rate":          "0.95",
		"cancellation_probability": "0.01",
		"is_inside_surge_zone":       "1",
		"idle_seconds":             "300.0",
	}).Err()
	if err != nil {
		t.Fatalf("Failed to seed Redis driver profile: %v", err)
	}
	// Clean up Redis profile after test runs
	defer redisClient.Del(ctx, profileKey)

	// 5. Spin up Telemetry Ingestion gRPC server
	t.Log("Starting Telemetry Ingestion gRPC server...")
	telemetryRedis := telemetryRepo.NewRedisRepository(redisClient)
	telemetryKafka := telemetryRepo.NewKafkaProducer(strings.Split(kafkaBrokers, ","))
	defer func() {
		if closer, ok := telemetryKafka.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
	}()

	telemetryUC := telemetryUsecase.NewTelemetryUseCase(telemetryRedis, telemetryKafka)
	ingestionHandler := grpcDelivery.NewLocationIngestionHandler(telemetryUC)

	listener, err := net.Listen("tcp", "127.0.0.1:50051")
	if err != nil {
		t.Fatalf("Failed to listen on port 50051: %v", err)
	}
	grpcServer := grpc.NewServer()
	pb.RegisterLocationIngestionServiceServer(grpcServer, ingestionHandler)
	go func() {
		_ = grpcServer.Serve(listener)
	}()
	defer grpcServer.GracefulStop()

	// 6. Spin up Dispatch Consumer loop
	t.Log("Starting Dispatch Consumer loop...")
	chService := graph.NewContractionHierarchiesService()
	chService.AddNode(&graph.CHNode{ID: 1001, Latitude: 22.5726, Longitude: 88.3639, Order: 1})
	chService.AddNode(&graph.CHNode{ID: 9999, Latitude: 22.5726, Longitude: 88.3639, Order: 2})
	chService.AddEdge(1001, 9999, 10.0, false)
	chService.AddEdge(9999, 1001, 10.0, false)
	routingSvc := &simpleRoutingService{chService: chService}
	etaCorrector := intelligenceUsecase.NewETACorrectorUseCase(nil, routingSvc)

	spatialScanner := dispatchRepo.NewSpatialScanner(redisClient)
	orderConsumer := consumer.NewOrderCreatedConsumer(
		strings.Split(kafkaBrokers, ","),
		"dispatch-integration-test-group",
		spatialScanner,
		dbPool,
		"GREEDY",
		etaCorrector,
	)
	defer orderConsumer.Close()

	consumerCtx, cancelConsumer := context.WithCancel(context.Background())
	defer cancelConsumer()

	go orderConsumer.StartExecutionPipeline(consumerCtx)

	// 7. Initialize Kafka consumer for order.assigned event
	t.Log("Setting up Kafka order.assigned reader...")
	assignedReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     strings.Split(kafkaBrokers, ","),
		Topic:       "order.assigned",
		GroupID:     "integration-test-assigned-checker",
		StartOffset: kafka.LastOffset,
	})
	defer assignedReader.Close()

	// 8. Stream driver location telemetry via gRPC
	t.Log("Sending driver position update via gRPC stream...")
	conn, err := grpc.NewClient("127.0.0.1:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to connect to gRPC server: %v", err)
	}
	defer conn.Close()

	client := pb.NewLocationIngestionServiceClient(conn)
	stream, err := client.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("Failed to open position stream: %v", err)
	}

	req := &pb.IngestionRequest{
		DriverId:     "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
		CityPrefix:   "KOL",
		Latitude:     22.5726,
		Longitude:    88.3639,
		Bearing:      90.0,
		SpeedKms:     30.0,
		TimestampUtc: time.Now().Unix(),
	}
	if err := stream.Send(req); err != nil {
		t.Fatalf("Failed to send position: %v", err)
	}

	resp, err := stream.CloseAndRecv()
	if err != nil {
		t.Fatalf("Failed to close and receive position response: %v", err)
	}
	if !resp.Success {
		t.Fatal("gRPC ingestion reported failure")
	}
	t.Log("Driver location ingested successfully.")

	// Let Redis propagation happen
	time.Sleep(1 * time.Second)

	// 9. Publish OrderCreated event to Kafka
	t.Log("Publishing OrderCreated event to Kafka...")
	kafkaWriter := kafka.NewWriter(kafka.WriterConfig{
		Brokers:  strings.Split(kafkaBrokers, ","),
		Topic:    "order.created",
		Balancer: &kafka.Hash{},
	})
	defer kafkaWriter.Close()

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

	orderPayload := OrderCreatedPayload{
		OrderID:         "f47ac10b-58cc-4372-a567-0e02b2c3d479",
		CityPrefix:      "KOL",
		CustomerID:      "c81d4e2e-bcf2-11e6-869b-7df243852131",
		PickupH3Cell:    "88754cb247fffff",
		PickupLat:       22.5730,
		PickupLng:       88.3642,
		PickupOSMNodeID: 1001,
		BaseFarePaise:   35000,
	}

	payloadBytes, err := json.Marshal(orderPayload)
	if err != nil {
		t.Fatalf("Failed to marshal order payload: %v", err)
	}

	err = kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(orderPayload.OrderID),
		Value: payloadBytes,
	})
	if err != nil {
		t.Fatalf("Failed to publish order event: %v", err)
	}
	t.Log("OrderCreated event published.")

	// 10. Wait and assert PostgreSQL Database updates
	t.Log("Waiting for matching assignment commit in PostgreSQL...")
	var status string
	var assignedDriverID string
	matchedSuccessfully := false

	for i := 0; i < 20; i++ {
		select {
		case <-ctx.Done():
			t.Fatal("Timeout waiting for order assignment in DB")
		default:
			err := dbPool.QueryRow(ctx, "SELECT status, assigned_driver_id FROM orders WHERE id = $1", orderPayload.OrderID).Scan(&status, &assignedDriverID)
			if err == nil && status == "ASSIGNED" && assignedDriverID == "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" {
				matchedSuccessfully = true
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if matchedSuccessfully {
			break
		}
	}

	if !matchedSuccessfully {
		t.Fatalf("Expected order to transition to ASSIGNED with driver 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', got status=%q driver=%q", status, assignedDriverID)
	}
	t.Log("Database order assignment verified.")

	// Check matching logs
	var totalEvaluated int
	var score float64
	err = dbPool.QueryRow(ctx, "SELECT total_candidates_evaluated, assignment_score FROM dispatch_match_logs WHERE order_id = $1", orderPayload.OrderID).Scan(&totalEvaluated, &score)
	if err != nil {
		t.Fatalf("Failed to query dispatch_match_logs: %v", err)
	}
	if totalEvaluated != 1 {
		t.Errorf("Expected 1 candidate evaluated, got %d", totalEvaluated)
	}
	t.Logf("Dispatch match logs verified. Assignment score: %f", score)

	// 11. Consume and verify order.assigned Kafka message
	t.Log("Reading assignment notification from order.assigned topic...")
	readCtx, readCancel := context.WithTimeout(ctx, 8*time.Second)
	defer readCancel()

	msg, err := assignedReader.ReadMessage(readCtx)
	if err != nil {
		t.Fatalf("Failed to consume order.assigned message: %v", err)
	}

	var assignedPayload map[string]interface{}
	if err := json.Unmarshal(msg.Value, &assignedPayload); err != nil {
		t.Fatalf("Failed to parse order.assigned payload: %v", err)
	}

	if assignedPayload["order_id"] != orderPayload.OrderID {
		t.Errorf("Expected order_id %q, got %q", orderPayload.OrderID, assignedPayload["order_id"])
	}
	if assignedPayload["driver_id"] != "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" {
		t.Errorf("Expected driver_id 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', got %q", assignedPayload["driver_id"])
	}
	t.Log("Kafka order.assigned notification event verified successfully!")
}
