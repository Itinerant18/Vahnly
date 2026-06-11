package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"

	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	grpcDelivery "github.com/platform/driver-delivery/internal/telemetry/delivery/grpc"
	"github.com/platform/driver-delivery/internal/telemetry/repository"
	"github.com/platform/driver-delivery/internal/telemetry/usecase"
	pb "github.com/platform/driver-delivery/pkg/api/telemetry/v1"
)

func main() {
	// 1. Core System Context & Configuration Setup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	grpcPort := getEnv("GRPC_PORT", "50051")
	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:7001,127.0.0.1:7002,127.0.0.1:7003")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "127.0.0.1:9092")
	
	log.Printf("Starting Location Ingestion Service. Target Scale: 100K active drivers.")

	// 2. Initialize PostgreSQL Connection Pool via pgxpool
	pgxConfig, err := pgxpool.ParseConfig(postgresURL)
	if err != nil {
		log.Fatalf("Unable to parse PostgreSQL connection string: %v", err)
	}
	
	// Tune connection pools for low-latency concurrent operations
	pgxConfig.MaxConns = 50
	pgxConfig.MinConns = 10
	pgxConfig.MaxConnIdleTime = 15 * time.Minute

	dbPool, err := pgxpool.NewWithConfig(ctx, pgxConfig)
	if err != nil {
		log.Fatalf("Failed to instantiate relational database connection pool: %v", err)
	}
	defer dbPool.Close()

	// Verify DB connectivity before proceeding
	if err := dbPool.Ping(ctx); err != nil {
		log.Fatalf("PostgreSQL database ping failed: %v", err)
	}
	log.Println("PostgreSQL connection pool initialized successfully.")

	// 3. Initialize Redis Cluster Driver (Explicitly bypassing Sentinel to eliminate failover lag)
	nodeList := strings.Split(redisNodes, ",")

	// Support local port-forwarded routing mapping
	ipMapStr := os.Getenv("REDIS_IP_MAP")
	ipMap := make(map[string]string)
	if ipMapStr != "" {
		for _, pair := range strings.Split(ipMapStr, ",") {
			parts := strings.Split(pair, "=")
			if len(parts) == 2 {
				ipMap[parts[0]] = parts[1]
			}
		}
	}

	redisClusterClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:        nodeList,
		ReadOnly:     false,
		RouteByLatency: true,
		DialTimeout:  2 * time.Second,
		ReadTimeout:  500 * time.Millisecond, // Strict sub-500ms lifecycle enforcement
		WriteTimeout: 500 * time.Millisecond,
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if localAddr, ok := ipMap[addr]; ok {
				addr = localAddr
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, addr)
		},
	})
	defer redisClusterClient.Close()

	// Verify Redis Cluster health
	if err := redisClusterClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis Cluster connection discovery failed: %v", err)
	}
	log.Println("Redis 6-shard Cluster state discovery finalized.")

	// 4. Initialize Dependency Tree Layers
	redisRepo := repository.NewRedisRepository(redisClusterClient)

	// Initialize real Kafka Producer
	brokersList := strings.Split(kafkaBrokers, ",")
	kafkaProducer := repository.NewKafkaProducer(brokersList)
	defer func() {
		if closer, ok := kafkaProducer.(interface{ Close() error }); ok {
			if err := closer.Close(); err != nil {
				log.Printf("Failed to close Kafka producer: %v", err)
			} else {
				log.Println("Kafka producer closed gracefully.")
			}
		}
	}()

	driverMetrics := repository.NewPostgresDriverMetrics(dbPool)
	telemetryUseCase := usecase.NewTelemetryUseCase(redisRepo, kafkaProducer, driverMetrics, redisClusterClient)

	// Set up and inject active-active RegionRouter for boundary checks in Kolkata cluster context
	handoffWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokersList...),
		Topic:        "global.region.handoffs",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireOne,
	}
	kafkacfg.FromEnv().ApplyToWriter(handoffWriter)
	defer handoffWriter.Close()

	regionRouter := usecase.NewRegionRouter(redisClusterClient, handoffWriter, "kolkata")
	if setter, ok := telemetryUseCase.(interface{ SetRegionRouter(router *usecase.RegionRouter) }); ok {
		setter.SetRegionRouter(regionRouter)
	}

	ingestionHandler := grpcDelivery.NewLocationIngestionHandler(telemetryUseCase)

	// 5. Initialize and Bind the gRPC TCP Server Loop
	listener, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("Failed to bind TCP network port loop %s: %v", grpcPort, err)
	}

	// Configure network keepalives to securely sustain thousands of long-lived driver streams
	grpcServer := grpc.NewServer(
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle:     15 * time.Minute,
			MaxConnectionAge:      2 * time.Hour,
			MaxConnectionAgeGrace: 5 * time.Minute,
			Time:                  2 * time.Hour,
			Timeout:               20 * time.Second,
		}),
	)

	pb.RegisterLocationIngestionServiceServer(grpcServer, ingestionHandler)

	// 6. Execute gRPC Listening Pipeline in a background thread
	go func() {
		log.Printf("Inbound gRPC telemetry hub actively listening on port %s...", grpcPort)
		if err := grpcServer.Serve(listener); err != nil && err != grpc.ErrServerStopped {
			log.Fatalf("gRPC server run loop failure: %v", err)
		}
	}()

	// 7. System Signal Intercept and Graceful Shutdown Protocol
	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	<-shutdownSignal
	log.Println("Shutdown request intercepted. Evacuating state pools and terminating connections cleanly...")

	// Create a hard boundary cutoff for pending thread completion during graceful termination
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	// Safely clear the gRPC server connection queue
	stopped := make(chan struct{})
	go func() {
		grpcServer.GracefulStop()
		close(stopped)
	}()

	select {
	case <-stopped:
		log.Println("All concurrent gRPC client streams gracefully closed.")
	case <-shutdownCtx.Done():
		log.Println("Shutdown deadline exceeded. Forcing sudden channel shutdown to isolate host pod.")
		grpcServer.Stop()
	}

	log.Println("Infrastructural dependency injection server cleanly terminated.")
}

// Helper utility parsing run environment values
func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}


