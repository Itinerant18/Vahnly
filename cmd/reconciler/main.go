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

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"

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

	// Expose Prometheus metrics (incl. the ledger-imbalance gauge) + K8s probes.
	// The reconciler previously had no scrape/health endpoint at all.
	metricsPort := getEnv("RECONCILER_METRICS_PORT", "8091")
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		})
		mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
			rctx, rcancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer rcancel()
			if err := dbPool.Ping(rctx); err != nil {
				http.Error(w, "db_unreachable", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ready"))
		})
		log.Printf("[RECONCILER] metrics/health server listening on :%s", metricsPort)
		if err := http.ListenAndServe(":"+metricsPort, mux); err != nil && err != http.ErrServerClosed {
			log.Printf("[RECONCILER] metrics server error: %v", err)
		}
	}()

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
