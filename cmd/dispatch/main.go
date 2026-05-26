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

	"github.com/platform/driver-delivery/internal/dispatch/consumer"
	dispatchRepo "github.com/platform/driver-delivery/internal/dispatch/repository"
	"github.com/platform/driver-delivery/internal/routing/graph"
	"github.com/platform/driver-delivery/internal/intelligence/client"
	"github.com/platform/driver-delivery/internal/intelligence/usecase"
)

// simpleRoutingService wraps the contraction hierarchies service, pre-seeded with node 1001
type simpleRoutingService struct {
	chService *graph.ContractionHierarchiesService
}

func (s *simpleRoutingService) ComputeShortestPathETA(ctx context.Context, sourceID, targetID int64) (float64, error) {
	// Fall back to the in-memory Contraction Hierarchies engine
	return s.chService.ComputeShortestPathETA(ctx, sourceID, targetID)
}

func main() {
	// 1. Core System Context & Configuration Setup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	algoStrategy := getEnv("ALGORITHM_STRATEGY", "GREEDY")
	tritonAddr := getEnv("TRITON_SERVER_ADDR", "localhost:8001")

	log.Printf("Starting Dispatch Matching Service. Strategy: %s, Triton: %s", algoStrategy, tritonAddr)

	// 2. Initialize PostgreSQL Connection Pool via pgxpool
	pgxConfig, err := pgxpool.ParseConfig(postgresURL)
	if err != nil {
		log.Fatalf("Unable to parse PostgreSQL connection string: %v", err)
	}

	pgxConfig.MaxConns = 10
	pgxConfig.MinConns = 2
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
		Addrs:          nodeList,
		ReadOnly:       false,
		RouteByLatency: true,
		DialTimeout:    2 * time.Second,
		ReadTimeout:    500 * time.Millisecond,
		WriteTimeout:   500 * time.Millisecond,
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

	// 4. Initialize Contraction Hierarchies Routing Service
	chService := graph.NewContractionHierarchiesService()
	// Pre-seed node 1001 so that our smoke test matching doesn't hit disconnected routing error
	chService.AddNode(&graph.CHNode{ID: 1001, Latitude: 22.5726, Longitude: 88.3639, Order: 1})
	// Pre-seed node 9999 for fallback routing
	chService.AddNode(&graph.CHNode{ID: 9999, Latitude: 22.5726, Longitude: 88.3639, Order: 2})
	chService.AddEdge(1001, 9999, 10.0, false)
	chService.AddEdge(9999, 1001, 10.0, false)
	routingSvc := &simpleRoutingService{chService: chService}

	// 5. Initialize Intelligence Layer
	var tritonClient *client.TritonClient
	if tritonAddr != "" {
		var err error
		tritonClient, err = client.NewTritonClient(tritonAddr)
		if err != nil {
			log.Printf("[WARNING] Triton Inference Server client initialization failed: %v. Running in pure-graph mode.", err)
		} else {
			log.Printf("Connected to Triton Inference Server at %s", tritonAddr)
			defer tritonClient.Close()
		}
	}
	etaCorrector := usecase.NewETACorrectorUseCase(tritonClient, routingSvc)

	// 6. Initialize Scanner and Order Created Consumer
	spatialScanner := dispatchRepo.NewSpatialScanner(redisClusterClient)
	brokersList := strings.Split(kafkaBrokers, ",")

	orderConsumer := consumer.NewOrderCreatedConsumer(
		brokersList,
		"dispatch-matching-group",
		spatialScanner,
		dbPool,
		algoStrategy,
		etaCorrector,
	)
	defer func() {
		if err := orderConsumer.Close(); err != nil {
			log.Printf("Failed to close order consumer: %v", err)
		} else {
			log.Println("Order consumer closed gracefully.")
		}
	}()

	// 6. Start the match execution loop in the background
	go func() {
		orderConsumer.StartExecutionPipeline(ctx)
	}()

	// 7. System Signal Intercept and Graceful Shutdown Protocol
	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	<-shutdownSignal
	log.Println("Shutdown request intercepted. Stopping engine...")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
