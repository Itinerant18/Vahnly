package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/platform/driver-delivery/internal/pricing/service"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	groupID := getEnv("PRICING_GROUP_ID", "pricing-service-consumer-group")

	pricingService := service.NewOrderPricingService(parseCSV(kafkaBrokers), groupID)
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
