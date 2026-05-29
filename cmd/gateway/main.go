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
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	httpPort := getEnv("HTTP_PORT", "8080")
	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	jwtSecret := getEnv("JWT_SECRET_SIGNING_KEY", "kolkata_marketplace_backbone_secret_token_string")

	log.Printf("Bootstrapping Multi-Pod Distributed API Gateway on Port: %s", httpPort)

	dbPool, err := pgxpool.New(ctx, postgresURL)
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

	// Initialize pricing service caching mechanisms
	pricingService := pricingSvc.NewOrderPricingService(brokersList, "gateway-pricing-group", redisClusterClient)
	go pricingService.StartSurgeMatrixSync(ctx)

	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokersList...),
		Topic:        "order.created",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	defer kafkaWriter.Close()

	handler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClusterClient)

	// Launch the single-pod Redis Pub/Sub listener routing routine
	go handler.InternalBackplaneMultiplexer(ctx)

	// Launch the single centralized Kafka-to-Redis fan-out sync engine for the pod
	go startKafkaToRedisFanoutWorker(ctx, brokersList, redisClusterClient)

	// Instantiate edge protection layers
	authGuard := middleware.NewAuthMiddleware(jwtSecret)
	// Rate Limit parameters: Allow maximum 5 requests per 1 minute rolling window
	rateLimiter := middleware.NewRateLimiterMiddleware(redisClusterClient, 5, 1*time.Minute)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/pricing/quote", handler.HandleGetPricingQuote)
	mux.HandleFunc("POST /api/v1/orders", authGuard.AuthenticateJWT(rateLimiter.LimitRouteConcurrency(handler.HandleCreateOrder)))
	mux.HandleFunc("GET /api/v1/dispatch/stream", authGuard.AuthenticateJWT(handler.HandleMatchRealtimeStream))

	server := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      mux,
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP web container crash: %v", err)
		}
	}()
	log.Println("Distributed API Gateway listening for active connection bounds.")

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal

	log.Println("Gracefully draining websocket connection channels...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}

// Sinks assignments from the single Kafka reader into the global Redis Pub/Sub cluster channel
func startKafkaToRedisFanoutWorker(ctx context.Context, brokers []string, client *redis.ClusterClient) {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		Topic:          "order.assigned",
		GroupID:        "gateway-fanout-group-collective", // Shared group balancing reads across all pods uniformly
		MinBytes:       10,
		MaxBytes:       10e6,
		CommitInterval: 1 * time.Second,
	})
	defer reader.Close()

	log.Println("[FANOUT_WORKER] Kafka order.assigned tracking daemon active.")

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

			// Broadcast the match event payload across all active cluster node channels
			err = client.Publish(ctx, gatewayHttp.RedisPubSubChannel, string(msg.Value)).Err()
			if err != nil {
				log.Printf("[FANOUT_ERROR] Failed broadcasting assignment to backplane channel: %v", err)
			}
		}
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
