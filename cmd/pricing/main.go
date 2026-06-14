package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/pricing/service"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	groupID := getEnv("PRICING_GROUP_ID", "pricing-service-consumer-group")
	redisAddrs := getEnv("REDIS_CLUSTER_ADDRS", "localhost:6379")

	clusterClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:    parseCSV(redisAddrs),
		Password: os.Getenv("REDIS_PASSWORD"),
	})
	defer clusterClient.Close()

	pricingService := service.NewOrderPricingService(parseCSV(kafkaBrokers), groupID, clusterClient)
	defer pricingService.Close()

	go pricingService.StartSurgeMatrixSync(ctx)

	log.Printf("Pricing service active with consumer group %s.", groupID)

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal
	log.Println("Shutdown request intercepted. Stopping pricing sync...")
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
