package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	"github.com/platform/driver-delivery/internal/dispatch/expiry"
	gatewayHttp "github.com/platform/driver-delivery/internal/gateway/delivery/http"
	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	pricingSvc "github.com/platform/driver-delivery/internal/pricing/service"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	redisNodes := getEnv("REDIS_CLUSTER_NODES", "127.0.0.1:6379")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	cityPrefix := getEnv("CITY_PREFIX", "KOL")

	log.Println("Bootstrapping Fleet Offer Expiration Janitor Engine Daemon...")

	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		log.Fatalf("Postgres link setup failed: %v", err)
	}
	defer dbPool.Close()

	nodeList := strings.Split(redisNodes, ",")
	redisClient := redis.NewClusterClient(&redis.ClusterOptions{Addrs: nodeList})
	defer redisClient.Close()

	brokersList := strings.Split(kafkaBrokers, ",")
	pricingService := pricingSvc.NewOrderPricingService(brokersList, "expiry-pricing-group", redisClient)

	kafkaWriter := &kafka.Writer{
		Addr:     kafka.TCP(brokersList...),
		Topic:    "order.created",
		Balancer: &kafka.Hash{},
	}
	kafkacfg.FromEnv().ApplyToWriter(kafkaWriter)
	defer kafkaWriter.Close()

	// Instantiate the Gateway Handler components to utilize its transaction rollback logic
	gatewayHandler := gatewayHttp.NewGatewayHandler(dbPool, kafkaWriter, pricingService, redisClient)

	janitorWorker := expiry.NewOfferTimeoutJanitor(dbPool, redisClient, gatewayHandler)
	
	// Launch the background janitor loop
	go janitorWorker.StartJanitorLoop(ctx, cityPrefix)

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal
	log.Println("Shutting down Expiration Janitor Daemon cleanly.")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
