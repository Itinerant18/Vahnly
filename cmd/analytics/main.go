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

	"github.com/platform/driver-delivery/internal/analytics/service"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	httpPort := getEnv("ANALYTICS_PORT", "8089")
	kafkaBrokers := getEnv("KAFKA_BROKERS", "localhost:19092")
	cityPrefix := getEnv("CITY_PREFIX", "KOL")

	log.Printf("Bootstrapping Single-Region Spatial Heatmap Analytics Daemon on Port: %s", httpPort)

	brokersList := strings.Split(kafkaBrokers, ",")
	analyticsSvc := service.NewHeatmapAnalyticsService(brokersList, "kolkata-analytics-heatmap-group")
	defer analyticsSvc.Close()

	// Launch async event matrix stream consumption in the background
	go analyticsSvc.StartAnalyticsProcessing(ctx, cityPrefix)

	mux := http.NewServeMux()
	// Map the public SSE channel definition
	mux.HandleFunc("/api/v1/analytics/heatmap", analyticsSvc.HandleHeatmapStream)

	server := &http.Server{
		Addr:         ":" + httpPort,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 0, // Server-Sent Events must run on un-bounded write timelines to stream indefinitely
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Analytics HTTP container initialization crash: %v", err)
		}
	}()
	log.Println("Geospatial Analytics Stream active. Ready to fuel real-time tracking maps.")

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	<-shutdownSignal

	log.Println("Shutting down Analytics web container cleanly...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
