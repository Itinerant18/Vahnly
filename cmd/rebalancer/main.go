package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/platform/driver-delivery/internal/intelligence/positioning"
	"github.com/redis/go-redis/v9"
)

func main() {
	redisNodesEnv := os.Getenv("REDIS_CLUSTER_NODES")
	if redisNodesEnv == "" {
		redisNodesEnv = "127.0.0.1:6379"
	}

	cityPrefix := os.Getenv("CITY_PREFIX")
	if cityPrefix == "" {
		cityPrefix = "KOL"
	}

	// Split comma-separated nodes list to support multi-node cluster settings
	var addrs []string
	for _, addr := range strings.Split(redisNodesEnv, ",") {
		addr = strings.TrimSpace(addr)
		if addr != "" {
			addrs = append(addrs, addr)
		}
	}

	rdb := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: addrs,
	})
	defer rdb.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rebalancer := positioning.NewFleetRebalancer(rdb, cityPrefix)

	go rebalancer.StartEvaluationLoop(ctx)

	log.Printf("[REBALANCER] Startup successful. FleetRebalancer monitoring active for prefix: %s", cityPrefix)

	// Graceful OS termination hook
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-sigChan

	log.Println("Shutting down Fleet Rebalancer daemon...")
	cancel()
}
