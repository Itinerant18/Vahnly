package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

// HealthServer provides /metrics, /health, /ready, and /api/v1/dispatch/stats endpoints.
type HealthServer struct {
	dbPool        *pgxpool.Pool
	redisClient   *redis.ClusterClient
	kafkaBrokers  []string
	algorithmUsed string
	startedAt     time.Time
}

// NewHealthServer creates a new HTTP observability server.
func NewHealthServer(db *pgxpool.Pool, rc *redis.ClusterClient, brokers []string, algo string) *HealthServer {
	return &HealthServer{
		dbPool:        db,
		redisClient:   rc,
		kafkaBrokers:  brokers,
		algorithmUsed: algo,
		startedAt:     time.Now(),
	}
}

// Start binds the HTTP server on the specified port.
func (h *HealthServer) Start(port string) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", h.healthHandler)
	mux.HandleFunc("/ready", h.readyHandler)
	mux.HandleFunc("/api/v1/dispatch/stats", h.statsHandler)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("Observability HTTP server listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("HTTP server error: %v", err)
	}
}

// healthHandler is a Kubernetes liveness probe — always returns 200 if the process is alive.
func (h *HealthServer) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy",
		"uptime": time.Since(h.startedAt).String(),
	})
}

// readyHandler is a Kubernetes readiness probe — checks Postgres, Redis, and Kafka connectivity.
func (h *HealthServer) readyHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	checks := make(map[string]string)
	allReady := true

	// Postgres check
	if err := h.dbPool.Ping(ctx); err != nil {
		checks["postgres"] = fmt.Sprintf("FAIL: %v", err)
		allReady = false
	} else {
		checks["postgres"] = "OK"
	}

	// Redis check
	if err := h.redisClient.Ping(ctx).Err(); err != nil {
		checks["redis"] = fmt.Sprintf("FAIL: %v", err)
		allReady = false
	} else {
		checks["redis"] = "OK"
	}

	// Kafka check
	dialer := &kafka.Dialer{Timeout: 2 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", h.kafkaBrokers[0])
	if err != nil {
		checks["kafka"] = fmt.Sprintf("FAIL: %v", err)
		allReady = false
	} else {
		conn.Close()
		checks["kafka"] = "OK"
	}

	w.Header().Set("Content-Type", "application/json")
	if allReady {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"ready":  allReady,
		"checks": checks,
	})
}

// statsHandler returns live dispatch KPIs as JSON.
func (h *HealthServer) statsHandler(w http.ResponseWriter, r *http.Request) {
	cbState := TritonCircuitBreaker.State()
	cbStateStr := "closed"
	switch cbState.String() {
	case "half-open":
		cbStateStr = "half-open"
	case "open":
		cbStateStr = "open"
	}

	stats := map[string]interface{}{
		"algorithm":            h.algorithmUsed,
		"uptime":               time.Since(h.startedAt).String(),
		"circuit_breaker":      cbStateStr,
		"metrics_endpoint":     "/metrics",
		"kafka_brokers":        strings.Join(h.kafkaBrokers, ","),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(stats)
}
