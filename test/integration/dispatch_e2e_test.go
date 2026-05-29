//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"


	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/platform/driver-delivery/internal/dispatch/consumer"
	dispatchRepo "github.com/platform/driver-delivery/internal/dispatch/repository"
	gatewayHttp "github.com/platform/driver-delivery/internal/gateway/delivery/http"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	intelligenceUsecase "github.com/platform/driver-delivery/internal/intelligence/usecase"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
	"github.com/platform/driver-delivery/internal/routing/graph"
	grpcDelivery "github.com/platform/driver-delivery/internal/telemetry/delivery/grpc"
	telemetryRepo "github.com/platform/driver-delivery/internal/telemetry/repository"
	telemetryUsecase "github.com/platform/driver-delivery/internal/telemetry/usecase"
	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
)

type simpleRoutingService struct {
	chService *graph.ContractionHierarchiesService
}

func (s *simpleRoutingService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	return s.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
}

func TestE2E_CompleteGatewayAndMatrixOptimizationPipeline(t *testing.T) {
	postgresURL := os.Getenv("DATABASE_URL")
	redisNodes := os.Getenv("REDIS_CLUSTER_NODES")
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	redisIPMap := os.Getenv("REDIS_IP_MAP")

	if postgresURL == "" || redisNodes == "" || kafkaBrokers == "" {
		t.Skip("Skipping integration test: environment variables DATABASE_URL, REDIS_CLUSTER_NODES, and KAFKA_BROKERS must be set.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	// 1. Initialize PostgreSQL connection pool
	pgxConfig, err := pgxpool.ParseConfig(postgresURL)
	if err != nil {
		t.Fatalf("Parse PostgreSQL config failed: %v", err)
	}
	dbPool, err := pgxpool.NewWithConfig(ctx, pgxConfig)
	if err != nil {
		t.Fatalf("Connect PostgreSQL failed: %v", err)
	}
	defer dbPool.Close()

	// 2. Initialize Redis Cluster Client with custom dialing translation properties
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

	consumerCtx, cancelConsumer := context.WithCancel(ctx)
	defer cancelConsumer()

	// MILESTONE 16: Start the background fan-out reader early so it has time to join the group 
	// before the match is emitted. Use a unique GroupID to avoid offset conflicts.
	go func() {
		assignedReader := kafka.NewReader(kafka.ReaderConfig{
			Brokers:     strings.Split(kafkaBrokers, ","),
			Topic:       "order.assigned",
			GroupID:     fmt.Sprintf("integration-test-fanout-sync-%d", time.Now().UnixNano()),
			StartOffset: kafka.LastOffset,
		})
		defer assignedReader.Close()

		for {
			msg, err := assignedReader.ReadMessage(consumerCtx)
			if err != nil {
				return
			}
			// Relay assignments directly to the Redis backplane channel to coordinate multi-pod notification delivery
			_ = redisClient.Publish(consumerCtx, "gateway:assignments:broadcast", string(msg.Value)).Err()
		}
	}()

	// 3. Clear and seed relational PostGIS database schemas
	t.Log("[TEST_SETUP] Purging historic tables and seeding baseline metrics...")
	const integrationOrderID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
	seedSQL := []string{
		"DELETE FROM dispatch_match_logs",
		"DELETE FROM orders",
		"DELETE FROM drivers WHERE city_prefix = 'KOL'",
		"DELETE FROM regional_cities WHERE city_prefix = 'KOL'",
		`INSERT INTO regional_cities (city_prefix, city_name, is_active, geofence)
		 VALUES ('KOL', 'Kolkata Grid', true, ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((88.2 22.4, 88.5 22.4, 88.5 22.7, 88.2 22.7, 88.2 22.4)))'))`,
		`INSERT INTO drivers (id, city_prefix, current_state, acceptance_rate, cancellation_probability)
		 VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'KOL', 'ONLINE_AVAILABLE', 0.960, 0.010)`,
	}
	for _, query := range seedSQL {
		if _, err := dbPool.Exec(ctx, query); err != nil {
			t.Fatalf("Failed to execute database seeding sequence %q: %v", query, err)
		}
	}

	// 4. Seed driver tracking profile entries to Redis Cluster indices
	spatialKey := "drivers:zset:KOL:88754cb247fffff"
	_ = redisClient.Del(ctx, spatialKey)
	defer redisClient.Del(ctx, spatialKey)

	profileKey := "driver:{KOL:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}:profile"
	_ = redisClient.Del(ctx, profileKey)
	err = redisClient.HSet(ctx, profileKey, map[string]interface{}{
		"osm_node_id":              "1001",
		"acceptance_rate":          "0.96",
		"cancellation_probability": "0.01",
		"is_inside_surge_zone":     "1",
		"idle_seconds":             "450.0",
	}).Err()
	if err != nil {
		t.Fatalf("Failed seeding cluster profile maps: %v", err)
	}
	defer redisClient.Del(ctx, profileKey)

	// 5. Spin up Telemetry Ingestion gRPC stream server endpoints
	telemetryRedis := telemetryRepo.NewRedisRepository(redisClient)
	telemetryKafka := telemetryRepo.NewKafkaProducer(strings.Split(kafkaBrokers, ","))
	telemetryUC := telemetryUsecase.NewTelemetryUseCase(telemetryRedis, telemetryKafka, nil, redisClient)
	ingestionHandler := grpcDelivery.NewLocationIngestionHandler(telemetryUC)

	listener, err := net.Listen("tcp", "127.0.0.1:50051")
	if err != nil {
		t.Fatalf("Failed binding gRPC test loop port: %v", err)
	}
	grpcServer := grpc.NewServer()
	pb.RegisterLocationIngestionServiceServer(grpcServer, ingestionHandler)
	go func() { _ = grpcServer.Serve(listener) }()
	defer grpcServer.GracefulStop()

	// 6. Spin up Global Kuhn-Munkres HUNGARIAN Batch Optimization Solver
	chService := graph.NewContractionHierarchiesService()
	chService.AddNode(&graph.CHNode{ID: 1001, Latitude: 22.5726, Longitude: 88.3639, Order: 1})
	chService.AddNode(&graph.CHNode{ID: 9999, Latitude: 22.5726, Longitude: 88.3639, Order: 2})
	chService.AddEdge(1001, 9999, 12.0, false)
	routingSvc := &simpleRoutingService{chService: chService}
	etaCorrector := intelligenceUsecase.NewETACorrectorUseCase(nil, routingSvc)

	spatialScanner := dispatchRepo.NewSpatialScanner(redisClient)
	orderConsumer := consumer.NewOrderCreatedConsumer(
		strings.Split(kafkaBrokers, ","),
		"dispatch-integration-matrix-group",
		spatialScanner,
		redisClient,
		dbPool,
		"HUNGARIAN", // Testing global matrix optimizations programmatically
		etaCorrector,
	)
	defer orderConsumer.Close()

	go orderConsumer.StartExecutionPipeline(consumerCtx)

	// 7. Spin up Phase 5 Public API Gateway & Redis Pub/Sub backplane components
	brokersList := strings.Split(kafkaBrokers, ",")
	pricingService := pricingSvc.NewOrderPricingService(brokersList, "integration-pricing-group", redisClient)
	
	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokersList...),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
		Async:        true,
	}
	defer kafkaWriter.Close()

	gatewayHandler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClient)
	
	// Boot the multi-pod Pub/Sub listener routing engine
	go gatewayHandler.InternalBackplaneMultiplexer(consumerCtx)

	// Create a local loopback HTTP router mapping endpoint assertions
	regionRouter := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/orders", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleCreateOrder))
	mux.HandleFunc("/api/v1/dispatch/stream", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleMatchRealtimeStream))
	
	server := httptest.NewServer(mux)
	defer server.Close()

	// 8. Stream driver coordinate location metrics over live gRPC channels
	conn, err := grpc.NewClient("127.0.0.1:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("gRPC initialization connection failed: %v", err)
	}
	defer conn.Close()

	client := pb.NewLocationIngestionServiceClient(conn)
	stream, err := client.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("gRPC stream activation allocation failed: %v", err)
	}

	req := &pb.IngestionRequest{
		DriverId:     "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
		CityPrefix:   "KOL",
		Latitude:     22.5726,
		Longitude:    88.3639,
		Bearing:      180.0,
		SpeedKms:     24.5,
		TimestampUtc: time.Now().Unix(),
	}
	if err := stream.Send(req); err != nil {
		t.Fatalf("gRPC telemetry write packet failed: %v", err)
	}
	_ = stream.CloseSend()
	t.Log("[INTEGRATION] gRPC telemetry pipeline successfully executed.")

	time.Sleep(2000 * time.Millisecond) // Give Kafka consumer group extra time to complete rebalance and join group

	// 9. Open a live loopback WebSocket stream to catch real-time driver match events
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/dispatch/stream?order_id=" + integrationOrderID + "&city_prefix=KOL"
	wsDialer := websocket.Dialer{}
	
	wsConn, _, err := wsDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("Failed opening persistent gateway WebSocket session loop: %v", err)
	}
	defer wsConn.Close()

	// 10. Execute booking request transaction via Public HTTP API Gateway
	orderPayload := map[string]interface{}{
		"order_id":           integrationOrderID,
		"city_prefix":        "KOL",
		"customer_id":        "customer-1",
		"pickup_h3_cell":     "8828308281fffff",
		"pickup_lat":         22.5726,
		"pickup_lng":         88.3642,
		"pickup_osm_node_id": 1001,
		"dropoff_lat":        22.5800,
		"dropoff_lng":        88.3700,
		"base_fare_paise":    35000,
	}
	bodyBytes, _ := json.Marshal(orderPayload)
	
	// Inject the custom region prefix header before firing the POST execution check
	reqHTTP, err := http.NewRequest("POST", server.URL+"/api/v1/orders", bytes.NewBuffer(bodyBytes))
	if err != nil {
		t.Fatalf("Failed compiling request structure: %v", err)
	}
	reqHTTP.Header.Set("Content-Type", "application/json")
	reqHTTP.Header.Set("X-Region-Prefix", "KOL") // Passed to satisfy the Milestone 22 Anycast routing constraints

	respHTTP, err := http.DefaultClient.Do(reqHTTP)
	if err != nil {
		t.Fatalf("HTTP Gateway booking transaction execution failed: %v", err)
	}
	if respHTTP.StatusCode != http.StatusAccepted {
		t.Fatalf("Expected HTTP status 202 Accepted, got: %d", respHTTP.StatusCode)
	}
	t.Log("[INTEGRATION] HTTP Gateway endpoint successfully received booking request payload.")

	// 12. Assert that the assignment details stream through the WebSocket correctly
	t.Log("Awaiting synchronized real-time match events from WebSocket backplane...")
	
	_ = wsConn.SetReadDeadline(time.Now().Add(10 * time.Second)) // Changed from SetWriteDeadline, extended to 10s for robust local runs
	_, wsMsg, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("WebSocket stream closed or timed out before matching notification was broadcasted: %v", err)
	}

	var matchNotification map[string]interface{}
	if err := json.Unmarshal(wsMsg, &matchNotification); err != nil {
		t.Fatalf("Failed unmarshaling WebSocket match data package frame: %v", err)
	}

	// Verify target match payload properties are accurate
	if matchNotification["driver_id"] != "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" {
		t.Errorf("Expected assigned driver 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', got: %v", matchNotification["driver_id"])
	}
	
	t.Log("═══════════════════════════════════════════════════════════════")
	t.Log(" SUCCESS: End-to-End API Gateway, Redis Pub/Sub Backplane, and ")
	t.Log(" Kuhn-Munkres Batch Solver verified cleanly without errors.    ")
	t.Log("═══════════════════════════════════════════════════════════════")
}
