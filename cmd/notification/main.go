package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/notification"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	postgresURL := getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable")
	log.Println("Bootstrapping Single-Region Asynchronous Transactional Outbox Notification Daemon...")

	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		log.Fatalf("PostgreSQL connection pool initialization failed: %v", err)
	}
	defer dbPool.Close()

	daemon := notification.NewOutboxNotificationDaemon(dbPool)

	// Start outbox processing loops concurrently
	go daemon.StartProcessingLoop(ctx)

	go startHealthServer("NOTIFICATION", getEnv("HEALTH_PORT", "8080"))

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal
	log.Println("Shutting down Outbox Notification Daemon cleanly.")
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

// startHealthServer exposes /health (liveness) and /ready (readiness) so this
// otherwise-portless background worker can be probed by Kubernetes. The scratch
// runtime image has no shell, so an exec probe is not an option.
func startHealthServer(tag, port string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})
	log.Printf("[%s] health server listening on :%s", tag, port)
	if err := http.ListenAndServe(":"+port, mux); err != nil && err != http.ErrServerClosed {
		log.Printf("[%s] health server error: %v", tag, err)
	}
}
