package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/dispatch/reconciler"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	cityPrefix := getEnv("CITY_PREFIX", "KOL")

	log.Println("Bootstrapping Single-Region Post-Crash Data Reconciliation Sync Worker...")

	// Initialize Relational Database Pool Link
	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		log.Fatalf("PostgreSQL pool initialization failed: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		log.Fatalf("PostgreSQL database ping failed: %v", err)
	}

	brokersList := strings.Split(kafkaBrokers, ",")
	syncWorker := reconciler.NewOrderReconcilerSyncWorker(dbPool, brokersList)
	defer syncWorker.Close()

	// Launch anti-entropy background processor thread
	go syncWorker.StartReconciliationLoop(ctx, cityPrefix)

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal
	log.Println("Shutting down Reconciliation Daemon cleanly.")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
