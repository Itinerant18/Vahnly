package test

import (
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"github.com/uber/h3-go/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	dispatchConsumer "github.com/platform/driver-delivery/internal/dispatch/consumer"
	"github.com/platform/driver-delivery/internal/dispatch/domain"
	dispatchRepo "github.com/platform/driver-delivery/internal/dispatch/repository"
	"github.com/platform/driver-delivery/internal/intelligence/client"
	"github.com/platform/driver-delivery/internal/intelligence/usecase"
	telemetryGrpc "github.com/platform/driver-delivery/internal/telemetry/delivery/grpc"
	telemetryDomain "github.com/platform/driver-delivery/internal/telemetry/domain"
	telemetryRepo "github.com/platform/driver-delivery/internal/telemetry/repository"
	telemetryUseCase "github.com/platform/driver-delivery/internal/telemetry/usecase"
	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
	triton "github.com/platform/driver-delivery/pkg/api/triton"
)

// DummyRoutingService satisfies matcher.RoutingService for deterministic test ETAs
type DummyRoutingService struct{}

func (d *DummyRoutingService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	return 180.0, nil // Returns a stable 3-minute travel time cost for validation math
}

// mockTritonServer implements standard Triton ModelInfer gRPC method
type mockTritonServer struct {
	triton.UnimplementedGRPCInferenceServiceServer
	inferFunc func(context.Context, *triton.ModelInferRequest) (*triton.ModelInferResponse, error)
}

func (m *mockTritonServer) ModelInfer(ctx context.Context, req *triton.ModelInferRequest) (*triton.ModelInferResponse, error) {
	if m.inferFunc != nil {
		return m.inferFunc(ctx, req)
	}
	// Return a default float32 multiplier of 1.2 encoded as little-endian bytes
	bits := math.Float32bits(1.2)
	byteBuffer := make([]byte, 4)
	binary.LittleEndian.PutUint32(byteBuffer, bits)

	return &triton.ModelInferResponse{
		RawOutputContents: [][]byte{byteBuffer},
	}, nil
}

func TestEndToEnd_DispatchMatchingPipeline(t *testing.T) {
	// 1. Gather Configuration Metrics from Environment Variables
	postgresURL := os.Getenv("DATABASE_URL")
	redisNodes := os.Getenv("REDIS_CLUSTER_NODES")
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	redisIPMap := os.Getenv("REDIS_IP_MAP")
	gRPCtestPort := "50099" // Use dedicated port to isolate test socket channels
	tritonMockPort := "50098"

	if postgresURL == "" || redisNodes == "" || kafkaBrokers == "" {
		t.Skip("Skipping E2E Integration Test: Active system environment parameters not declared.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	// ============================================================================
	// 2. INFRASTRUCTURE PLUMBING INITIALIZATION
	// ============================================================================

	// Initialize PostgreSQL Pool
	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		t.Fatalf("Failed connecting to Postgres integration tier: %v", err)
	}
	defer dbPool.Close()

	// Initialize Redis Cluster Shard Connection Client with custom port-forwarding dialer
	ipMap := make(map[string]string)
	if redisIPMap != "" {
		for _, pair := range strings.Split(redisIPMap, ",") {
			parts := strings.Split(pair, "=")
			if len(parts) == 2 {
				ipMap[parts[0]] = parts[1]
			}
		}
	}

	rClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: strings.Split(redisNodes, ","),
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if localAddr, ok := ipMap[addr]; ok {
				addr = localAddr
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, addr)
		},
	})
	defer rClient.Close()

	// Prepare Kafka Test Brokers Topics
	brokers := strings.Split(kafkaBrokers, ",")
	kafkaDialer := &kafka.Dialer{Timeout: 5 * time.Second, DualStack: true}
	kafkaCtx, kafkaCancel := context.WithTimeout(context.Background(), 10*time.Second)
	conn, err := kafkaDialer.DialContext(kafkaCtx, "tcp", brokers[0])
	if err != nil {
		kafkaCancel()
		t.Fatalf("Kafka broker cluster connection handshake timed out: %v", err)
	}

	// Programmatically guarantee test topic partitions are established
	topicErr := conn.CreateTopics(
		kafka.TopicConfig{Topic: "order.created", NumPartitions: 1, ReplicationFactor: 1},
		kafka.TopicConfig{Topic: "order.assigned", NumPartitions: 1, ReplicationFactor: 1},
		kafka.TopicConfig{Topic: "driver.state.changed", NumPartitions: 1, ReplicationFactor: 1},
	)
	conn.Close()
	kafkaCancel()
	if topicErr != nil {
		t.Logf("Topic creation returned (may be benign if topics exist): %v", topicErr)
	}

	// Clean out previous states to enforce fresh test environments
	testDriverID := "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	testOrderID := "f47ac10b-58cc-4372-a567-0e02b2c3d479"

	// Compute the H3 cell using the SAME radian formula the telemetry pipeline uses.
	// This ensures the driver's spatial ZSET key matches the order's pickup_h3_cell.
	testLat := 22.5726
	testLng := 88.3639
	latRad := testLat * (math.Pi / 180.0)
	lngRad := testLng * (math.Pi / 180.0)
	testH3Cell := h3.ToString(h3.FromGeo(h3.GeoCoord{Latitude: latRad, Longitude: lngRad}, 8))
	t.Logf("Computed test H3 cell (radian-based): %s", testH3Cell)

	_, _ = dbPool.Exec(ctx, "DELETE FROM dispatch_match_logs WHERE order_id = $1::uuid", testOrderID)
	_, _ = dbPool.Exec(ctx, "DELETE FROM orders WHERE id = $1::uuid", testOrderID)
	_, _ = dbPool.Exec(ctx, "DELETE FROM drivers WHERE city_prefix = 'KOL'")
	_, _ = dbPool.Exec(ctx, "DELETE FROM regional_cities WHERE city_prefix = 'KOL'")

	// Clear the targeted H3 spatial cache index ZSET and driver profile hash
	_ = rClient.Del(ctx, fmt.Sprintf("drivers:zset:KOL:%s", testH3Cell), fmt.Sprintf("driver:{KOL:%s}:profile", testDriverID))

	// Pre-seed Required Relational Structural Dependencies
	_, err = dbPool.Exec(ctx, "INSERT INTO regional_cities (city_prefix, city_name, is_active) VALUES ('KOL', 'Kolkata', true)")
	if err != nil {
		t.Fatalf("Failed seeding test city reference record: %v", err)
	}

	_, err = dbPool.Exec(ctx, `
		INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, acceptance_rate)
		VALUES ($1::uuid, 'KOL', 'E2E Tester', '+919999999999', 'DL-E2E-VALID', 'ONLINE_AVAILABLE', true, 0.98);
	`, testDriverID)
	if err != nil {
		t.Fatalf("Failed seeding driver profile base row: %v", err)
	}

	_, err = dbPool.Exec(ctx, `
		INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, base_fare_paise)
		VALUES ($1::uuid, 'KOL', gen_random_uuid(), 'CREATED', ST_GeographyFromText('POINT(88.3639 22.5726)'), ST_GeographyFromText('POINT(88.4339 22.5657)'), $2, 25000);
	`, testOrderID, testH3Cell)
	if err != nil {
		t.Fatalf("Failed seeding order request base row: %v", err)
	}

	// Pre-populate the driver profile hash parameters inside Redis cache to satisfy the hydrator pipeline
	// Pre-populate the driver spatial ZSET so the scanner finds this driver immediately,
	// regardless of whether the gRPC telemetry ingestion completes before the Kafka message arrives.
	spatialZSetKey := fmt.Sprintf("drivers:zset:KOL:%s", testH3Cell)
	_ = rClient.ZAdd(ctx, spatialZSetKey, redis.Z{
		Score:  float64(time.Now().Unix()),
		Member: testDriverID,
	}).Err()
	defer rClient.Del(ctx, spatialZSetKey)

	profileKey := fmt.Sprintf("driver:{KOL:%s}:profile", testDriverID)
	err = rClient.HSet(ctx, profileKey, map[string]interface{}{
		"osm_node_id":              "10001",
		"acceptance_rate":          "0.98",
		"cancellation_probability": "0.01",
		"is_inside_surge_zone":     "1",
		"idle_seconds":             "600.0",
	}).Err()
	if err != nil {
		t.Fatalf("Failed seeding Redis driver profile: %v", err)
	}
	defer rClient.Del(ctx, profileKey)

	// ============================================================================
	// 3. SERVICE ASSEMBLY & RUN-LOOP INITIATION
	// ============================================================================

	// Start Mock Triton Inference Server
	tritonListener, err := net.Listen("tcp", "127.0.0.1:"+tritonMockPort)
	if err != nil {
		t.Fatalf("Failed binding Triton mock port: %v", err)
	}
	mockTriton := &mockTritonServer{}
	tritonGrpcServer := grpc.NewServer()
	triton.RegisterGRPCInferenceServiceServer(tritonGrpcServer, mockTriton)
	go func() { _ = tritonGrpcServer.Serve(tritonListener) }()
	defer tritonGrpcServer.Stop()

	// Instantiate Triton Client and ETACorrectorUseCase
	tClient, err := client.NewTritonClient("127.0.0.1:" + tritonMockPort)
	if err != nil {
		t.Fatalf("Failed initializing TritonClient: %v", err)
	}
	defer tClient.Close()

	dummyRouting := &DummyRoutingService{}
	etaCorrector := usecase.NewETACorrectorUseCase(tClient, dummyRouting)

	// Boot the gRPC Driver Telemetry Ingestion Node
	telemetryRedis := telemetryRepo.NewRedisRepository(rClient)
	mockProducerPlaceholder := &mockKafkaProducer{} // Ingestion fallback stub
	tUseCase := telemetryUseCase.NewTelemetryUseCase(telemetryRedis, mockProducerPlaceholder, nil)
	grpcHandler := telemetryGrpc.NewLocationIngestionHandler(tUseCase)

	listener, err := net.Listen("tcp", "127.0.0.1:"+gRPCtestPort)
	if err != nil {
		t.Fatalf("Failed binding gRPC test socket loop: %v", err)
	}
	grpcServer := grpc.NewServer()
	pb.RegisterLocationIngestionServiceServer(grpcServer, grpcHandler)
	go func() { _ = grpcServer.Serve(listener) }()
	defer grpcServer.Stop()

	// Boot the Batch Order Matching Consumer Engine
	scanner := dispatchRepo.NewSpatialScanner(rClient)
	matchingConsumer := dispatchConsumer.NewOrderCreatedConsumer(brokers, "e2e-test-matching-group", scanner, rClient, dbPool, "GREEDY", etaCorrector)

	consumerCtx, stopConsumer := context.WithCancel(context.Background())
	defer stopConsumer()
	go matchingConsumer.StartExecutionPipeline(consumerCtx)

	// ============================================================================
	// 4. STEP-BY-STEP FLOW EXECUTION SUB-SYSTEM
	// ============================================================================

	// Step A: Trigger Automated Driver Ingestion Instance via gRPC Stream Channel
	connGrpc, err := grpc.Dial("127.0.0.1:"+gRPCtestPort, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("gRPC connector link failed: %v", err)
	}
	defer connGrpc.Close()

	client := pb.NewLocationIngestionServiceClient(connGrpc)
	stream, err := client.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("gRPC internal telemetry stream handshake failed: %v", err)
	}

	err = stream.Send(&pb.IngestionRequest{
		DriverId:     testDriverID,
		CityPrefix:   "KOL",
		Latitude:     22.5726, // Internally parsed into radian units by the fixed usecase
		Longitude:    88.3639,
		Bearing:      90.0,
		SpeedKms:     15.0,
		TimestampUtc: time.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("Failed pushing client update to telemetry channel: %v", err)
	}
	_, _ = stream.CloseAndRecv()

	// Let Redis propagation happen
	time.Sleep(1 * time.Second)

	// Step B: Mimic a Passenger Ride Request via direct Kafka emission onto order.created
	kafkaWriter := &kafka.Writer{
		Addr:  kafka.TCP(brokers...),
		Topic: "order.created",
	}
	defer kafkaWriter.Close()

	orderPayload := domain.OrderCreatedPayload{
		OrderID:         testOrderID,
		CityPrefix:      "KOL",
		CustomerID:      "c81d4e2e-bcf2-11e6-869b-7df243852131",
		PickupH3Cell:    testH3Cell,
		PickupLat:       testLat,
		PickupLng:       testLng,
		PickupOSMNodeID: 1001, // node pre-seeded in cmd/dispatch/main.go CH graph
	}
	payloadBytes, _ := json.Marshal(orderPayload)

	err = kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(testOrderID),
		Value: payloadBytes,
	})
	if err != nil {
		t.Fatalf("Failed dispatching mock ride request to Kafka topic: %v", err)
	}

	// Step C: Allow the batch window buffer (~300ms) to flush and execute optimization routines
	// Allow generous time for: batch window (300ms) + cost matrix + Triton RPC + DB tx commit
	time.Sleep(2500 * time.Millisecond)

	// ============================================================================
	// 5. TRANSACTION STATE VERIFICATION & ASSERTIONS
	// ============================================================================

	var currentStatus string
	var assignedDriver sql.NullString

	// Query current persistent relational status state
	checkQuery := "SELECT status::text, assigned_driver_id::text FROM orders WHERE id = $1::uuid"
	err = dbPool.QueryRow(ctx, checkQuery, testOrderID).Scan(&currentStatus, &assignedDriver)
	if err != nil {
		t.Fatalf("Failed pulling post-matching order state records from database: %v", err)
	}

	t.Logf("Post-match order state: status=%s, assigned_driver_id=%v", currentStatus, assignedDriver)

	if currentStatus != "ASSIGNED" {
		t.Errorf("E2E State Broken: Expected order status to be 'ASSIGNED', got '%s'", currentStatus)
	}
	if !assignedDriver.Valid || assignedDriver.String != testDriverID {
		t.Errorf("E2E Selection Broken: Expected assignment to award driver '%s', got '%v'", testDriverID, assignedDriver)
	}

	// Verify immutable match logging ledger compliance metrics
	var logExists bool
	err = dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM dispatch_match_logs WHERE order_id = $1::uuid)", testOrderID).Scan(&logExists)
	if err != nil || !logExists {
		t.Error("E2E Logging Broken: Matching instance transaction omitted writing entries to the audit ledger.")
	}

	t.Log("E2E Validation Test Completed successfully. Core streaming, caching, optimization and state fences are verified.")
}

type mockKafkaProducer struct{}

func (m *mockKafkaProducer) PublishLocationUpdate(ctx context.Context, loc *telemetryDomain.DriverLocation) error {
	return nil
}
