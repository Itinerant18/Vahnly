package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/platform/driver-delivery/internal/events"
	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	"github.com/segmentio/kafka-go"
)

type HeatmapAnalyticsService struct {
	kafkaReader *kafka.Reader
	dlq         *kafkacfg.DLQ

	// Thread-safe map tracking active driver allocations per H3 Hexagon cell index
	// Key: H3Cell string, Value: Count int64
	cellDensityMap sync.Map

	// Mutex guarding the active dashboard client registration pools
	clientMutex sync.RWMutex
	clients     map[chan []byte]struct{}
}

func NewHeatmapAnalyticsService(brokers []string, groupID string) *HeatmapAnalyticsService {
	sec := kafkacfg.FromEnv()
	return &HeatmapAnalyticsService{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:        brokers,
			Topic:          "driver.state.changed", // Consumes unified driver lifecycle movements
			GroupID:        groupID,
			MinBytes:       10,
			MaxBytes:       10e6,
			CommitInterval: 1 * time.Second,
			Dialer:         sec.Dialer(),
		}),
		dlq:     kafkacfg.NewDLQ(brokers, "driver.state.changed.dlq", sec),
		clients: make(map[chan []byte]struct{}),
	}
}

// StartAnalyticsProcessing reads driver transitions and increments cell state counts dynamically
func (s *HeatmapAnalyticsService) StartAnalyticsProcessing(ctx context.Context, cityPrefix string) {
	log.Printf("[ANALYTICS_CORE] Operational Fleet Tracking active for region [%s]. Stream sinking launched.", cityPrefix)

	// Launch a sub-worker thread to periodically push consolidated matrix updates to active dashboard connections
	go s.startBroadcastTicker(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Println("[ANALYTICS_CORE] Halting Kafka analytics consumption pipeline safely.")
			return
		default:
			msg, err := s.kafkaReader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				continue
			}

			var event events.DriverStateChangedEvent
			if err := json.Unmarshal(msg.Value, &event); err != nil {
				_ = s.dlq.Publish(ctx, msg, "json_unmarshal_failed: "+err.Error())
				continue
			}

			// Filter events matching our region boundary (KOL) to keep operations isolated
			if event.CityPrefix != cityPrefix || event.H3Cell == "" {
				continue
			}

			s.updateInternalDensityMatrix(event)
		}
	}
}

func (s *HeatmapAnalyticsService) updateInternalDensityMatrix(event events.DriverStateChangedEvent) {
	// If the driver transitioned to ONLINE_AVAILABLE, ensure they are incremented in the target hexagon
	if event.CurrentState == "ONLINE_AVAILABLE" && event.PreviousState != "ONLINE_AVAILABLE" {
		actual, _ := s.cellDensityMap.LoadOrStore(event.H3Cell, int64(0))
		s.cellDensityMap.Store(event.H3Cell, actual.(int64)+1)
	}

	// If the driver leaves the available pool (e.g., transitions to OFFLINE or EN_ROUTE), decrement them
	if event.PreviousState == "ONLINE_AVAILABLE" && event.CurrentState != "ONLINE_AVAILABLE" {
		if val, found := s.cellDensityMap.Load(event.H3Cell); found {
			newCount := val.(int64) - 1
			if newCount <= 0 {
				s.cellDensityMap.Delete(event.H3Cell)
			} else {
				s.cellDensityMap.Store(event.H3Cell, newCount)
			}
		}
	}
}

// startBroadcastTicker groups spatial records and flushes snapshot maps every 2 seconds
func (s *HeatmapAnalyticsService) startBroadcastTicker(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			snapshot := make(map[string]int64)
			s.cellDensityMap.Range(func(key, value interface{}) bool {
				snapshot[key.(string)] = value.(int64)
				return true
			})

			// Broadcast even when empty so dashboards can clear stale cells and
			// distinguish a live-but-idle feed from a broken connection.
			payloadBytes, err := json.Marshal(map[string]interface{}{
				"region":    "KOL",
				"timestamp": time.Now().Unix(),
				"cell_data": snapshot,
			})
			if err != nil {
				continue
			}

			s.broadcastToSubscribers(payloadBytes)
		}
	}
}

func (s *HeatmapAnalyticsService) broadcastToSubscribers(payload []byte) {
	s.clientMutex.RLock()
	defer s.clientMutex.RUnlock()

	for clientChan := range s.clients {
		select {
		case clientChan <- payload:
		default:
			// Prevent slower network consumer lines from stalling the global broadcasting loop
		}
	}
}

// HandleHeatmapStream establishes high-velocity Server-Sent Events (SSE) lines to client applications
func (s *HeatmapAnalyticsService) HandleHeatmapStream(w http.ResponseWriter, r *http.Request) {
	// Enforce strict chunked streaming SSE content headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*") // Allows live UI maps to hook in easily

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "server_sent_events_unsupported", http.StatusInternalServerError)
		return
	}

	// Register a unique communication sync channel for this incoming dashboard socket
	clientChan := make(chan []byte, 10)
	s.clientMutex.Lock()
	s.clients[clientChan] = struct{}{}
	s.clientMutex.Unlock()

	defer func() {
		s.clientMutex.Lock()
		delete(s.clients, clientChan)
		close(clientChan)
		s.clientMutex.Unlock()
		log.Println("[ANALYTICS_SSE] Cleanly released dashboard socket connection frame.")
	}()

	log.Println("[ANALYTICS_SSE] Active operational dashboard client attached to spatial heatmap stream.")

	// Send an immediate heartbeat so the client's onopen fires and the connection
	// is confirmed live even before the first density snapshot is produced.
	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
		return
	}
	flusher.Flush()

	// Periodic keep-alive comments stop idle SSE connections (no drivers online)
	// from being dropped by intermediary proxies.
	keepAlive := time.NewTicker(15 * time.Second)
	defer keepAlive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case data := <-clientChan:
			// Format data payload matching the clear W3C SSE wire standard specification
			_, err := fmt.Fprintf(w, "data: %s\n\n", string(data))
			if err != nil {
				return
			}
			flusher.Flush() // Explicitly push bytes down the open HTTP pipe immediately
		}
	}
}

func (s *HeatmapAnalyticsService) Close() error {
	_ = s.dlq.Close()
	return s.kafkaReader.Close()
}
