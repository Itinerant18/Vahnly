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
	"github.com/platform/driver-delivery/internal/dispatch/scheduler"
	"github.com/platform/driver-delivery/internal/intelligence/client"
	"github.com/platform/driver-delivery/internal/intelligence/usecase"
	"github.com/platform/driver-delivery/internal/observability"
	googleRouting "github.com/platform/driver-delivery/internal/routing/google"
	"github.com/platform/driver-delivery/internal/routing/graph"
	"github.com/platform/driver-delivery/internal/storage/migration"
)

func main() {
	// 1. Core System Context & Configuration Setup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tp, err := observability.InitTracerProvider("dispatch-matching-service")
	if err != nil {
		log.Fatalf("OpenTelemetry trace infrastructure provider boot failed: %v", err)
	}
	defer func() { _ = tp.Shutdown(context.Background()) }()

	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	algoStrategy := getEnv("ALGORITHM_STRATEGY", "HUNGARIAN")  // Defaulting to global batch matrix matching
	tritonURL := getEnv("TRITON_SERVER_URL", "127.0.0.1:8001") // Enforcing IPv4 explicit coordinate mapping
	migrationsPath := getEnv("DATABASE_MIGRATIONS_PATH", "file://database/migrations")

	log.Printf("Starting Dispatch Matching Service. Target Strategy Matrix: %s", algoStrategy)

	// MILESTONE 11 INTEGRATION GATE: Enforce programmatic schema validation before service setup
	log.Println("Initializing programmatic schema synchronization validations...")
	if err := migration.AutoRunDatabaseMigrations(postgresURL, migrationsPath); err != nil {
		log.Fatalf("Database migration setup failed. Halting system components: %v", err)
	}

	// 2. Initialize PostgreSQL Connection Pool via pgxpool
	pgxConfig, err := pgxpool.ParseConfig(postgresURL)
	if err != nil {
		log.Fatalf("Unable to parse PostgreSQL connection string: %v", err)
	}
	pgxConfig.MaxConns = 20
	pgxConfig.MinConns = 4
	pgxConfig.MaxConnLifetime = 1 * time.Hour
	pgxConfig.MaxConnIdleTime = 30 * time.Minute

	dbPool, err := pgxpool.NewWithConfig(ctx, pgxConfig)
	if err != nil {
		log.Fatalf("Failed to instantiate relational database connection pool: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		log.Fatalf("PostgreSQL database ping failed: %v", err)
	}
	log.Println("PostgreSQL connection pool initialized successfully.")

	// 3. Initialize Redis Cluster Driver (Bypassing Sentinel to eliminate failover lag)
	nodeList := strings.Split(redisNodes, ",")

	// Support local port-forwarded routing mapping (required for k8s dev environments)
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
		Password:       os.Getenv("REDIS_PASSWORD"),
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

	if err := redisClusterClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis Cluster connection discovery failed: %v", err)
	}
	log.Println("Redis 6-shard Cluster state discovery finalized.")

	// 4. Initialize Triton Inference Server Client
	var tritonClient *client.TritonClient
	if tritonURL != "" {
		var tritonErr error
		tritonClient, tritonErr = client.NewTritonClient(tritonURL)
		if tritonErr != nil {
			log.Printf("[WARNING] Triton client init failed: %v. Running in pure-graph mode.", tritonErr)
		} else {
			log.Printf("Connected to Triton Inference Server at %s", tritonURL)
			defer tritonClient.Close()
		}
	}

	// 5. Initialize Contraction Hierarchies Routing Service & Loader
	nodesPath := getEnv("OSM_NODES_DATA_PATH", "./data/kolkata_nodes.csv")
	edgesPath := getEnv("OSM_EDGES_DATA_PATH", "./data/kolkata_edges.csv")

	chService := graph.NewContractionHierarchiesService()
	graphLoader := graph.NewGraphLoader(chService)

	if _, err := os.Stat(nodesPath); err == nil {
		loadCtx, loadCancel := context.WithTimeout(ctx, 10*time.Minute)
		if err := graphLoader.IngestContractedTopology(loadCtx, nodesPath, edgesPath); err != nil {
			loadCancel()
			log.Fatalf("Critical error during road network graph initialization: %v", err)
		}
		loadCancel()
	} else {
		log.Printf("[WARNING] Dataset files missing at %s. Bootstrapping container with minimum local seed node configurations.", nodesPath)
		chService.AddNode(&graph.CHNode{ID: 1001, Latitude: 22.5726, Longitude: 88.3639, Order: 1})
		// Node 9999 is the fallback OSM node for drivers with stale Redis profiles
		chService.AddNode(&graph.CHNode{ID: 9999, Latitude: 22.5726, Longitude: 88.3639, Order: 2})
		chService.AddEdge(1001, 9999, 10.0, false)
		chService.AddEdge(9999, 1001, 10.0, false)
	}

	googleMapsKey := getEnv("GOOGLE_MAPS_API_KEY", getEnv("VITE_GOOGLE_MAPS_API_KEY", ""))
	routingSvc := googleRouting.NewPremiumHybridRouter(googleMapsKey, chService, redisClusterClient)

	etaCorrector := usecase.NewETACorrectorUseCase(tritonClient, routingSvc)

	// 6. Assemble Structural Abstractions & Matching Consumer
	spatialScanner := dispatchRepo.NewSpatialScanner(redisClusterClient)
	brokersList := strings.Split(kafkaBrokers, ",")

	orderConsumer := consumer.NewOrderCreatedConsumer(
		brokersList,
		"dispatch-matching-group",
		spatialScanner,
		redisClusterClient,
		dbPool,
		algoStrategy,
		etaCorrector,
	)
	defer func() {
		if err := orderConsumer.Close(); err != nil {
			log.Printf("Failed to close order consumer: %v", err)
		}
	}()

	// 7. Start Match Execution and Active-Active Hydration Loops in Background Threads
	currentRegion := getEnv("CURRENT_REGION", "kolkata")
	handoffConsumer := consumer.NewHandoffConsumer(
		brokersList,
		"global.region.handoffs",
		"dispatch-handoff-"+currentRegion,
		currentRegion,
		redisClusterClient,
	)
	defer func() {
		if err := handoffConsumer.Close(); err != nil {
			log.Printf("Failed to close handoff consumer: %v", err)
		}
	}()
	go handoffConsumer.Start(ctx)

	go orderConsumer.StartExecutionPipeline(ctx)

	// Scheduled-booking sweeper: replays future-dated orders onto order.created near pickup.
	go scheduler.New(dbPool, brokersList).Run(ctx)

	// 8. Start HTTP Observability Server (Prometheus + Health + Stats)
	metricsPort := getEnv("METRICS_PORT", "8080")
	healthServer := observability.NewHealthServer(dbPool, redisClusterClient, brokersList, algoStrategy)
	go healthServer.Start(metricsPort)

	// 9. System Signal Intercept and Graceful Shutdown Protocol
	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	<-shutdownSignal
	log.Println("Shutdown request intercepted. Stopping core dispatch match loops...")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists { //
		return value
	}
	return defaultValue //
}
