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
	"github.com/platform/driver-delivery/internal/telemetry/pruner"
	"github.com/redis/go-redis/v9"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")

	log.Println("Bootstrapping Enterprise Telemetry Garbage Collector Daemon...")

	// Connect to Relational Storage Tier
	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		log.Fatalf("Postgres connection pool initiation failed: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		log.Fatalf("Postgres database ping failed: %v", err)
	}

	// Connect to Distributed Sharded Storage Tier
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
		log.Fatalf("Redis cluster heartbeat check failed: %v", err)
	}

	// Mock active operational zones matching your workspace cell layouts
	trackedZones := []string{"88754cb247fffff", "88283473fffffff"}

	prunerDaemon := pruner.NewStaleTelemetryPruner(redisClusterClient, dbPool)

	// Boot the sweeping loop worker thread
	go prunerDaemon.StartPrunerLoop(ctx, "KOL", trackedZones)

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal
	log.Println("Shutting down Telemetry Garbage Collector Daemon cleanly.")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
