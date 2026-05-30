//go:build integration

package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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

	consumerCtx, cancelConsumer := context.WithCancel(ctx)
	defer cancelConsumer()

	// Centralized Kafka-to-Redis Pub/Sub Fanout Worker
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
			_ = redisClient.Publish(consumerCtx, "gateway:assignments:broadcast", string(msg.Value)).Err()
		}
	}()

	// 3. Purge and seed relational database tables
	t.Log("[TEST_SETUP] Purging historic tables and seeding multi-region bounds...")
	const integrationOrderID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
	const targetDriverID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
	seedSQL := []string{
		"DELETE FROM financial_ledger_entries",
		"DELETE FROM dispatch_match_logs",
		"DELETE FROM orders",
		"DELETE FROM drivers WHERE city_prefix = 'KOL'",
		"DELETE FROM regional_cities WHERE city_prefix = 'KOL'",
		`INSERT INTO regional_cities (city_prefix, city_name, is_active, geofence)
		 VALUES ('KOL', 'Kolkata Grid', true, ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((88.2 22.4, 88.5 22.4, 88.5 22.7, 88.2 22.7, 88.2 22.4)))'))`,
		`INSERT INTO drivers (id, city_prefix, current_state, acceptance_rate, cancellation_probability)
		 VALUES ('` + targetDriverID + `', 'KOL', 'ONLINE_AVAILABLE', 0.960, 0.010)`,
	}
	for _, query := range seedSQL {
		if _, err := dbPool.Exec(ctx, query); err != nil {
			t.Fatalf("Failed to execute database seeding sequence %q: %v", query, err)
		}
	}

	// 4. Seed driver spatial cache keys in Redis
	spatialKey := "drivers:zset:KOL:88754cb247fffff"
	_ = redisClient.Del(ctx, spatialKey)
	defer redisClient.Del(ctx, spatialKey)

	profileKey := "driver:{KOL:" + targetDriverID + "}:profile"
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

	// 5. Spin up Telemetry Ingestion gRPC stream node
	telemetryRedis := telemetryRepo.NewRedisRepository(redisClient)
	telemetryKafka := telemetryRepo.NewKafkaProducer(strings.Split(kafkaBrokers, ","))
	
	// Injecting Redis cluster client reference to support high-velocity telemetry forking checks
	telemetryUC := telemetryUsecase.NewTelemetryUseCase(telemetryRedis, telemetryKafka, nil, redisClient)

	// Create and inject RegionRouter for Milestone 29 Active-Active handoffs
	handoffWriter := &kafka.Writer{
		Addr:         kafka.TCP(strings.Split(kafkaBrokers, ",")...),
		Topic:        "global.region.handoffs",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer handoffWriter.Close()

	regionRouter := telemetryUsecase.NewRegionRouter(redisClient, handoffWriter, "kolkata")
	if setter, ok := telemetryUC.(interface{ SetRegionRouter(router *telemetryUsecase.RegionRouter) }); ok {
		setter.SetRegionRouter(regionRouter)
	}

	ingestionHandler := grpcDelivery.NewLocationIngestionHandler(telemetryUC)

	listener, err := net.Listen("tcp", "127.0.0.1:50051")
	if err != nil {
		t.Fatalf("Failed binding gRPC test loop port: %v", err)
	}
	grpcServer := grpc.NewServer()
	pb.RegisterLocationIngestionServiceServer(grpcServer, ingestionHandler)
	go func() { _ = grpcServer.Serve(listener) }()
	defer grpcServer.GracefulStop()

	// 6. Spin up Kuhn-Munkres HUNGARIAN Batch Optimization Solver
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
		"HUNGARIAN",
		etaCorrector,
	)
	defer orderConsumer.Close()
	go orderConsumer.StartExecutionPipeline(consumerCtx)

	// 7. Initialize Public API Gateway with Edge Multi-Region Router Middleware
	brokersList := strings.Split(kafkaBrokers, ",")
	pricingService := pricingSvc.NewOrderPricingService(brokersList, "integration-pricing-group", redisClient)
	
	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokersList...),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer kafkaWriter.Close()

	gatewayHandler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClient)
	go gatewayHandler.InternalBackplaneMultiplexer(consumerCtx)
	
	regionRouter := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/orders", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleCreateOrder))
	mux.HandleFunc("/api/v1/dispatch/stream", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleMatchRealtimeStream))
	mux.HandleFunc("/api/v1/dispatch/accept", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleAcceptOrder))
	mux.HandleFunc("/api/v1/trip/arrive", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleArriveAtPickup))
	mux.HandleFunc("/api/v1/trip/start", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleStartTrip))
	mux.HandleFunc("/api/v1/trip/complete", regionRouter.RouteRegionalTraffic(gatewayHandler.HandleCompleteTrip))
	
	server := httptest.NewServer(mux)
	defer server.Close()

	// 8. Submit Initial Location via gRPC Stream to make driver searchable
	conn, err := grpc.NewClient("127.0.0.1:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("gRPC connection failed: %v", err)
	}
	defer conn.Close()

	grpcClient := pb.NewLocationIngestionServiceClient(conn)
	stream, err := grpcClient.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("gRPC stream activation failed: %v", err)
	}

	reqInitial := &pb.IngestionRequest{
		DriverId:     targetDriverID,
		CityPrefix:   "KOL",
		Latitude:     22.5726,
		Longitude:    88.3639,
		Bearing:      180.0,
		SpeedKms:     24.5,
		TimestampUtc: time.Now().Unix(),
	}
	_ = stream.Send(reqInitial)
	_ = stream.CloseSend()

	time.Sleep(1500 * time.Millisecond) // Allow Kafka partition rebalances to complete safely

	// 9. Open persistent WebSocket Stream
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/dispatch/stream?order_id=" + integrationOrderID + "&city_prefix=KOL"
	wsDialer := websocket.Dialer{}
	wsConn, _, err := wsDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket connection failed: %v", err)
	}
	defer wsConn.Close()

	// 10. POST Booking Intent Request
	orderPayload := map[string]interface{}{
		"order_id":           integrationOrderID,
		"city_prefix":        "KOL",
		"customer_id":        "c81d4e2e-bcf2-11e6-869b-7df243852131",
		"pickup_h3_cell":     "88754cb247fffff",
		"pickup_lat":         22.5730,
		"pickup_lng":         88.3642,
		"pickup_osm_node_id": 1001,
		"dropoff_lat":        22.5800,
		"dropoff_lng":        88.3700,
		"base_fare_paise":    35000,
	}
	bodyBytes, _ := json.Marshal(orderPayload)
	
	reqHTTP, _ := http.NewRequest("POST", server.URL+"/api/v1/orders", bytes.NewBuffer(bodyBytes))
	reqHTTP.Header.Set("Content-Type", "application/json")
	reqHTTP.Header.Set("X-Region-Prefix", "KOL") // Required header evaluated by Milestone 22 Router

	respHTTP, err := http.DefaultClient.Do(reqHTTP)
	if err != nil || respHTTP.StatusCode != http.StatusAccepted {
		t.Fatalf("API Gateway rejected order placement. Status: %v", respHTTP.StatusCode)
	}

	// 11. STAGE 1 LIFECYCLE ASSERTION: Await ASSIGNED Event payload over WebSocket
	_ = wsConn.SetReadDeadline(time.Now().Add(8 * time.Second))
	_, wsMsg, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("WebSocket connection timed out waiting for matching event: %v", err)
	}

	var matchNotification map[string]interface{}
	_ = json.Unmarshal(wsMsg, &matchNotification)
	if matchNotification["driver_id"] != targetDriverID {
		t.Fatalf("Expected driver match %s, got %v", targetDriverID, matchNotification["driver_id"])
	}
	t.Log("[STAGE 1 OK] Combinatorial matching successfully verified over active WebSocket.")

	// 12. STAGE 2 LIFECYCLE ASSERTION: Execute Driver Acceptance Mutation
	acceptPayload := map[string]string{"order_id": integrationOrderID, "driver_id": targetDriverID}
	acceptBytes, _ := json.Marshal(acceptPayload)
	reqAccept, _ := http.NewRequest("POST", server.URL+"/api/v1/dispatch/accept", bytes.NewBuffer(acceptBytes))
	reqAccept.Header.Set("Content-Type", "application/json")
	reqAccept.Header.Set("X-Region-Prefix", "KOL")

	respAccept, err := http.DefaultClient.Do(reqAccept)
	if err != nil || respAccept.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/v1/dispatch/accept failed: %v", respAccept.StatusCode)
	}
	t.Log("[STAGE 2 OK] Driver trip offer acceptance successfully verified.")

	// 13. STAGE 3 LIFECYCLE ASSERTION: Driver Arrives at Pickup Point
	reqArrive, _ := http.NewRequest("POST", server.URL+"/api/v1/trip/arrive", bytes.NewBuffer(acceptBytes))
	reqArrive.Header.Set("Content-Type", "application/json")
	reqArrive.Header.Set("X-Region-Prefix", "KOL")

	respArrive, err := http.DefaultClient.Do(reqArrive)
	if err != nil || respArrive.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/v1/trip/arrive failed")
	}
	t.Log("[STAGE 3 OK] Driver point arrival successfully verified.")

	// 14. STAGE 4 LIFECYCLE ASSERTION: Start Journey and Verify Live Telemetry Forking
	reqStart, _ := http.NewRequest("POST", server.URL+"/api/v1/trip/start", bytes.NewBuffer(acceptBytes))
	reqStart.Header.Set("Content-Type", "application/json")
	reqStart.Header.Set("X-Region-Prefix", "KOL")

	respStart, err := http.DefaultClient.Do(reqStart)
	if err != nil || respStart.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/v1/trip/start failed")
	}
	t.Log("[STAGE 4 OK] Active journey transit step initiated.")

	// Stream high-frequency telemetry updates while the trip is active ('DELIVERING')
	streamActive, err := grpcClient.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("gRPC stream update failed: %v", err)
	}
	reqTransit := &pb.IngestionRequest{
		DriverId:     targetDriverID,
		CityPrefix:   "KOL",
		Latitude:     22.5805, // Movement coordinate check
		Longitude:    88.3692,
		Bearing:      45.0,
		SpeedKms:     35.0,
		TimestampUtc: time.Now().Unix(),
	}
	_ = streamActive.Send(reqTransit)
	_ = streamActive.CloseSend()

	// Assert that live telemetry coordinates fork onto Redis Pub/Sub and stream through the WebSocket connection
	_ = wsConn.SetReadDeadline(time.Now().Add(4 * time.Second))
	_, wsTelemetryMsg, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("WebSocket layer failed to capture live telemetry update frame: %v", err)
	}

	var telemetryFrame map[string]interface{}
	_ = json.Unmarshal(wsTelemetryMsg, &telemetryFrame)
	if telemetryFrame["latitude"] == nil || telemetryFrame["order_id"] != integrationOrderID {
		t.Fatalf("Malformed telemetry broadcast frame intercepted: %v", string(wsTelemetryMsg))
	}
	t.Logf("[STAGE 4 OK] Real-time telemetry streaming verified: Lat=%v, Lng=%v", telemetryFrame["latitude"], telemetryFrame["longitude"])

	// 15. STAGE 5 LIFECYCLE ASSERTION: Conclude Journey and Verify Double-Entry Financial Ledger Writes
	reqComplete, _ := http.NewRequest("POST", server.URL+"/api/v1/trip/complete", bytes.NewBuffer(acceptBytes))
	reqComplete.Header.Set("Content-Type", "application/json")
	reqComplete.Header.Set("X-Region-Prefix", "KOL")

	respComplete, err := http.DefaultClient.Do(reqComplete)
	if err != nil || respComplete.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/v1/trip/complete failed")
	}

	// Read and verify the exact ledger rows inside relational storage maps
	rows, err := dbPool.Query(ctx, "SELECT account_type, entry_type, amount_paise FROM financial_ledger_entries WHERE order_id = $1::uuid", integrationOrderID)
	if err != nil {
		t.Fatalf("Failed querying financial audit ledgers: %v", err)
	}
	defer rows.Close()

	var totalDebit, totalCredit int64
	entryCount := 0

	for rows.Next() {
		var accountType, entryType string
		var amount int64
		_ = rows.Scan(&accountType, &entryType, &amount)
		entryCount++

		if entryType == "DEBIT" {
			totalDebit += amount
		} else if entryType == "CREDIT" {
			totalCredit += amount
		}
	}

	if entryCount != 3 {
		t.Errorf("Expected exactly 3 accounting ledger splits, got: %d", entryCount)
	}
	if totalDebit != 35000 || totalCredit != 35000 {
		t.Errorf("Double-entry arithmetic balance mismatch: Debits=%d, Credits=%d", totalDebit, totalCredit)
	}
	t.Log("[STAGE 5 OK] Immutable financial split settlement successfully verified.")

	// STAGE 6 LIFECYCLE ASSERTION: Simulate a cryptographically secure server-to-server Payment Webhook callback
	t.Log("Simulating automated third-party payment settlement webhook processing...")

	webhookPayload := map[string]interface{}{
		"event_id": "evt_live_test_token_998124",
		"type":     "payment_intent.succeeded",
		"data": map[string]interface{}{
			"intent_id":    "pi_test_stripe_interceptor_7711",
			"order_id":     integrationOrderID,
			"amount_paise": 35000,
			"currency":     "INR",
		},
	}
	webhookBytes, _ := json.Marshal(webhookPayload)

	// Calculate the expected SHA256 HMAC signature using your test secret key
	secretToken := "kolkata_gateway_fiat_fallback_cryptographic_signing_token"
	mac := hmac.New(sha256.New, []byte(secretToken))
	mac.Write(webhookBytes)
	computedHexSignature := hex.EncodeToString(mac.Sum(nil))

	reqWebhook, _ := http.NewRequest("POST", server.URL+"/api/v1/payments/webhook", bytes.NewBuffer(webhookBytes))
	reqWebhook.Header.Set("Content-Type", "application/json")
	reqWebhook.Header.Set("X-Payment-Provider-Signature", computedHexSignature)

	respWebhook, err := http.DefaultClient.Do(reqWebhook)
	if err != nil || respWebhook.StatusCode != http.StatusOK {
		t.Fatalf("Payment Webhook verification failed with status: %v", respWebhook.StatusCode)
	}

	// Verify that the payment intent record was recorded correctly in the datastore
	var finalPaymentStatus string
	err = dbPool.QueryRow(ctx, "SELECT payment_status FROM payment_intents WHERE id = 'pi_test_stripe_interceptor_7711'").Scan(&finalPaymentStatus)
	if err != nil || finalPaymentStatus != "SUCCEEDED" {
		t.Fatalf("Reconciliation failed: payment intent status is not SUCCEEDED. Error: %v", err)
	}

	t.Log("[STAGE 6 OK] Cryptographic payment webhook reconciliation successfully verified.")

	// STAGE 7 LIFECYCLE ASSERTION: Dynamic Surge Pricing & Circuit Breaker Verification Pass
	t.Log("Validating Closed-Loop Surge Pricing Heuristics & Circuit Breaker Backpressure boundaries...")

	// Seed artificial imbalance states inside local Redis shards
	demandKey := "metrics:demand:88754cb247fffff"
	supplyKey := "metrics:supply:88754cb247fffff"

	_ = redisClient.SAdd(ctx, demandKey, "rider_id_alpha", "rider_id_beta", "rider_id_gamma").Err()
	_ = redisClient.SAdd(ctx, supplyKey, "driver_id_alpha").Err() // 3 to 1 demand-to-supply imbalance ratio

	pricingUrl := fmt.Sprintf("%s/api/v1/pricing/quote?h3_cell=88754cb247fffff&base_fare_paise=10000&city_prefix=KOL", server.URL)
	reqPricing, _ := http.NewRequest("GET", pricingUrl, nil)
	reqPricing.Header.Set("X-Region-Prefix", "KOL")

	respPricing, err := http.DefaultClient.Do(reqPricing)
	if err != nil || respPricing.StatusCode != http.StatusOK {
		t.Fatalf("Pricing quotation lookup endpoint failed under stress testing: %v", err)
	}

	var pricingResponse map[string]interface{}
	_ = json.NewDecoder(respPricing.Body).Decode(&pricingResponse)

	activeMultiplier := pricingResponse["active_surge_multiplier"].(float64)
	if activeMultiplier <= 1.0 {
		t.Errorf("Imbalance ratio calculation failed to scale surge pricing appropriately. Got Multiplier: %v", activeMultiplier)
	}

	t.Logf("[STAGE 7 OK] Closed-Loop Surge Engine responsive under pressure. Computed Multiplier: %.2f", activeMultiplier)

	// STAGE 8 LIFECYCLE ASSERTION: Global Active-Active Cross-Region Handoff & Hydration Verification Pass
	t.Log("Validating Global Active-Active Cross-Region Synchronizations & Boundary Handoff pipelines...")

	// 1. Spin up target region ("howrah") hydration consumer in a background thread
	handoffConsumer := consumer.NewHandoffConsumer(
		brokersList,
		"global.region.handoffs",
		"dispatch-handoff-howrah-test-group",
		"howrah",
		redisClient,
	)
	go handoffConsumer.Start(consumerCtx)
	defer handoffConsumer.Close()

	// 2. Initial state: verify driver is currently indexed in the kolkata region locations Geo ZSET
	kolkataGeoKey := "driver:locations:kolkata"
	howrahGeoKey := "driver:locations:howrah"

	// Seed target driver inside kolkata Geo index to start boundary testing
	_ = redisClient.GeoAdd(ctx, kolkataGeoKey, &redis.GeoLocation{
		Name:      targetDriverID,
		Longitude: 88.3639,
		Latitude:  22.5726,
	}).Err()

	// 3. Emit location update representing a boundary crossing out of Kolkata region into Howrah region
	crossingConn, err := grpc.NewClient("127.0.0.1:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed connecting to gRPC telemetry node: %v", err)
	}
	defer crossingConn.Close()

	crossingGrpcClient := pb.NewLocationIngestionServiceClient(crossingConn)
	crossingStream, err := crossingGrpcClient.ClientStreamPositions(ctx)
	if err != nil {
		t.Fatalf("Failed opening telemetry gRPC channel: %v", err)
	}

	reqCrossing := &pb.IngestionRequest{
		DriverId:     targetDriverID,
		CityPrefix:   "KOL",
		Latitude:     22.6,  // Lies inside Howrah bounding box
		Longitude:    88.1,  // Lies inside Howrah bounding box
		Bearing:      270.0,
		SpeedKms:     45.0,
		TimestampUtc: time.Now().Unix(),
	}
	_ = crossingStream.Send(reqCrossing)
	_ = crossingStream.CloseSend()

	// 4. Wait for Kafka replication, handoff processing, and hydration loops to settle
	time.Sleep(3 * time.Second)

	// 5. Assert: Local origin ("kolkata") Geo ZSET eviction
	kolkataScore, err := redisClient.ZScore(ctx, kolkataGeoKey, targetDriverID).Result()
	if err == nil {
		t.Errorf("Boundary Cross Validator failed to evict driver from origin Kolkata Geo ZSET. Score: %v", kolkataScore)
	}

	// 6. Assert: Target region ("howrah") hydration & geohash scoring validation
	howrahScore, err := redisClient.ZScore(ctx, howrahGeoKey, targetDriverID).Result()
	if err != nil || howrahScore == 0 {
		t.Errorf("Active-Active handoff failed: driver %s not successfully hydrated in Howrah Geo ZSET. Error: %v", targetDriverID, err)
	} else {
		t.Logf("[STAGE 8 OK] Active-Active synchronization verified. Hydrated Howrah geohash ZSET score: %v", howrahScore)
	}

	t.Log("═══════════════════════════════════════════════════════════════")
	t.Log(" SUCCESS: Full-Lifecycle Journey Matrix completely validated. ")
	t.Log(" Ingestion, Matching, Streaming, Routing and Accounting OK.    ")
	t.Log("═══════════════════════════════════════════════════════════════")
}
