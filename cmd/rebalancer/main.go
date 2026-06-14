package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

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
		Addrs:    addrs,
		Password: os.Getenv("REDIS_PASSWORD"),
	})
	defer rdb.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rebalancer := positioning.NewFleetRebalancer(rdb, cityPrefix)

	go rebalancer.StartEvaluationLoop(ctx)

	// Internal incentive API: lets the inference engine / simulator drive
	// positioning nudges to specific H3 cells (POST /api/internal/surge/nudge).
	httpAddr := os.Getenv("REBALANCER_HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = ":8090"
	}
	mux := http.NewServeMux()
	mux.Handle("/api/internal/surge/nudge", positioning.NewNudgeHTTPHandler(rebalancer))
	srv := &http.Server{Addr: httpAddr, Handler: mux}
	go func() {
		log.Printf("[REBALANCER] Incentive API listening on %s", httpAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[REBALANCER] incentive API server error: %v", err)
		}
	}()

	log.Printf("[REBALANCER] Startup successful. FleetRebalancer monitoring active for prefix: %s", cityPrefix)

	// Graceful OS termination hook
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-sigChan

	log.Println("Shutting down Fleet Rebalancer daemon...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = srv.Shutdown(shutdownCtx)
	shutdownCancel()
	cancel()
}
