package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	gatewayHttp "github.com/platform/driver-delivery/internal/gateway/delivery/http"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/platform/driver-delivery/internal/observability"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
)

func main() {
	// Root execution context
	mainCtx, mainCancel := context.WithCancel(context.Background())
	defer mainCancel()

	tp, err := observability.InitTracerProvider("api-gateway-service")
	if err != nil {
		log.Fatalf("OpenTelemetry trace infrastructure provider boot failed: %v", err)
	}
	defer func() { _ = tp.Shutdown(context.Background()) }()

	httpPort := getEnv("HTTP_PORT", "8080")
	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	jwtSecret := getEnv("JWT_SECRET_SIGNING_KEY", "kolkata_marketplace_backbone_secret_token_string")

	log.Printf("Bootstrapping Coordinated API Gateway on Port: %s", httpPort)

	dbPool, err := pgxpool.New(mainCtx, postgresURL)
	if err != nil {
		log.Fatalf("PostgreSQL connection pool setup failed: %v", err)
	}
	defer dbPool.Close()

	nodeList := strings.Split(redisNodes, ",")
	redisClusterClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: nodeList,
	})
	defer redisClusterClient.Close()

	brokersList := strings.Split(kafkaBrokers, ",")

	pricingService := pricingSvc.NewOrderPricingService(brokersList, "gateway-pricing-group", redisClusterClient)
	go pricingService.StartSurgeMatrixSync(mainCtx)

	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokersList...),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer kafkaWriter.Close()

	handler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClusterClient)
	handler.SetJWTSecret(jwtSecret)

	go handler.InternalBackplaneMultiplexer(mainCtx)
	go startKafkaToRedisFanoutWorker(mainCtx, brokersList, redisClusterClient)

	// Instantiate edge protection layers
	authGuard := middleware.NewAuthMiddleware(jwtSecret)
	// Rate Limit parameters: Allow maximum 5 requests per 1 minute rolling window
	rateLimiter := middleware.NewRateLimiterMiddleware(redisClusterClient, 5, 1*time.Minute)

	// MILESTONE 22 INITIALIZATION: Instantiate the Region Shard Router
	rawSupportedRegions := getEnv("SUPPORTED_REGIONS_MATRIX", "KOL,BLR") // Declare active shards
	supportedRegions := strings.Split(rawSupportedRegions, ",")
	regionRouter := middleware.NewRegionRouterMiddleware(supportedRegions)

	mux := http.NewServeMux()
	
	// Authentication / Access routes
	mux.HandleFunc("POST /api/v1/auth/rider/login", handler.HandleRiderLogin)
	mux.HandleFunc("POST /api/v1/auth/driver/login", handler.HandleDriverLogin)

	mux.HandleFunc("GET /api/v1/pricing/quote", regionRouter.RouteRegionalTraffic(handler.HandleGetPricingQuote))
	mux.HandleFunc("POST /api/v1/orders", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleCreateOrder))))
	mux.HandleFunc("GET /api/v1/dispatch/stream", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(handler.HandleMatchRealtimeStream)))
	mux.HandleFunc("POST /api/v1/dispatch/accept", authGuard.AuthenticateJWT(rateLimiter.LimitRouteConcurrency(handler.HandleAcceptOrder)))
	mux.HandleFunc("POST /api/v1/dispatch/decline", authGuard.AuthenticateJWT(rateLimiter.LimitRouteConcurrency(handler.HandleDeclineOrder)))
	mux.HandleFunc("POST /api/v1/trip/arrive", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleArriveAtPickup))))
	mux.HandleFunc("POST /api/v1/trip/start", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleStartTrip))))
	mux.HandleFunc("POST /api/v1/trip/complete", authGuard.AuthenticateJWT(regionRouter.RouteRegionalTraffic(rateLimiter.LimitRouteConcurrency(handler.HandleCompleteTrip))))
	mux.HandleFunc("POST /api/v1/payments/webhook", handler.HandlePaymentWebhook)

	// Register administrative control routes, protected by the Admin role gate
	mux.HandleFunc("GET /api/v1/admin/ledger", authGuard.RequireRole("ADMIN", handler.HandleAdminGetLedger))
	mux.HandleFunc("POST /api/v1/admin/drivers/override", authGuard.RequireRole("ADMIN", handler.HandleAdminDriverOverride))

	corsMiddleware := middleware.NewCORSMiddleware()

	server := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      corsMiddleware.Handler(mux),
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP web container crash: %v", err)
		}
	}()
	log.Println("API Gateway active and accepting connections.")

	// Intercept container termination signals from Kubernetes or OS handles
	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal

	log.Println("Intercepted termination signal. Stopping inbound traffic routing routes...")

	// 1. Create a dedicated context window for the graceful draining sequence
	drainCtx, drainCancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer drainCancel()

	// 2. Shut down the HTTP listener first so the load balancer stops routing new requests to this instance
	_ = server.Shutdown(drainCtx)

	// 3. Broadcast CloseGoingAway handshakes across all active persistent WebSocket sessions
	handler.DrainAndSignalWebSockets(drainCtx)

	// 4. Cancel the main execution context to cleanly stop internal background workers
	mainCancel()
	
	log.Println("Gateway process terminated cleanly. Zero connection truncation errors encountered.")
}

func startKafkaToRedisFanoutWorker(ctx context.Context, brokers []string, client *redis.ClusterClient) {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		Topic:          "order.assigned",
		GroupID:        "gateway-fanout-group-collective",
		MinBytes:       10,
		MaxBytes:       10e6,
		CommitInterval: 1 * time.Second,
	})
	defer reader.Close()

	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := reader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				continue
			}
			_ = client.Publish(ctx, gatewayHttp.RedisPubSubChannel, string(msg.Value)).Err()
		}
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
