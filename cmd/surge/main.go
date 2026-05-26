package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/surge/aggregator"
	"github.com/platform/driver-delivery/internal/surge/calculator"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	cityPrefix := getEnv("SURGE_CITY_PREFIX", "KOL")
	trackedCells := parseCSV(os.Getenv("SURGE_TRACKED_CELLS"))

	redisClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:        parseCSV(redisNodes),
		DialTimeout:  2 * time.Second,
		ReadTimeout:  500 * time.Millisecond,
		WriteTimeout: 500 * time.Millisecond,
	})
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis Cluster connection failed: %v", err)
	}

	brokers := parseCSV(kafkaBrokers)

	supplyStream := aggregator.NewSupplyAggregatorStream(brokers, redisClient)
	defer supplyStream.Close()

	demandStream := aggregator.NewDemandAggregatorStream(brokers, redisClient)
	defer demandStream.Close()

	surgeEngine := calculator.NewSurgeCalculatorEngine(brokers, redisClient)
	defer surgeEngine.Close()

	go supplyStream.StartAggregationEngine(ctx)
	go demandStream.StartDemandEngine(ctx)
	if len(trackedCells) > 0 {
		go surgeEngine.StartCalculatorLoop(ctx, cityPrefix, trackedCells)
	} else {
		log.Println("SURGE_TRACKED_CELLS is empty; surge.zone.updated publishing is disabled.")
	}

	log.Printf("Surge service active for city %s with %d tracked cells.", cityPrefix, len(trackedCells))

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal
	log.Println("Shutdown request intercepted. Stopping surge workers...")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func parseCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}
