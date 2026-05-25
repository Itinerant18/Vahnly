package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/segmentio/kafka-go"
)

// SurgeZoneUpdatedEvent matches the JSON schema emitted by the Surge Calculator (Job 3)
type SurgeZoneUpdatedEvent struct {
	H3Cell          string  `json:"h3_cell"`
	CityPrefix      string  `json:"city_prefix"`
	SurgeMultiplier float64 `json:"surge_multiplier"`
	DemandCount     int64   `json:"demand_count"`
	SupplyCount     int64   `json:"supply_count"`
}

type OrderPricingService struct {
	kafkaReader *kafka.Reader
	mu          sync.RWMutex
	// In-memory grid joining pricing indices across localized regional scopes
	// Compound map key structure: {city_prefix}:{h3_cell}
	surgeMatrix map[string]float64
}

func NewOrderPricingService(brokers []string, groupID string) *OrderPricingService {
	return &OrderPricingService{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:  brokers,
			Topic:    "surge.zone.updated", // Consumes output from our Job 3 pricing engine
			GroupID:  groupID,              // Horizontal group scaling configuration
			MinBytes: 10,
			MaxBytes: 10e6,
		}),
		surgeMatrix: make(map[string]float64),
	}
}

// StartSurgeMatrixSync pumps event loops from Kafka to continuously update the in-memory pricing state
func (s *OrderPricingService) StartSurgeMatrixSync(ctx context.Context) {
	log.Println("Order Pricing Service: Safely synchronized with surge.zone.updated pipeline.")
	
	for {
		select {
		case <-ctx.Done():
			log.Println("Closing pricing matrix synchronization pipelines cleanly.")
			return
		default:
			msg, err := s.kafkaReader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Printf("Pricing data pipeline exception: %v", err)
				continue
			}

			var event SurgeZoneUpdatedEvent
			if err := json.Unmarshal(msg.Value, &event); err != nil {
				log.Printf("Dropped malformed surge pricing log event: %v", err)
				continue
			}

			// Generate slot-safe uniform map reference layout
			mapKey := fmt.Sprintf("%s:%s", event.CityPrefix, event.H3Cell)

			// Safely write the updated multiplier to the matrix cache
			s.mu.Lock()
			s.surgeMatrix[mapKey] = event.SurgeMultiplier
			s.mu.Unlock()
		}
	}
}

// CalculateFare joins base operational metrics with live multipliers to output exact trip costs
func (s *OrderPricingService) CalculateFare(cityPrefix string, pickupH3Cell string, baseFarePaise int64) (int64, float64) {
	mapKey := fmt.Sprintf("%s:%s", cityPrefix, pickupH3Cell)
	multiplier := 1.0

	// Instant O(1) read lock evaluation protecting the sub-500ms processing loop
	s.mu.RLock()
	if liveMultiplier, exists := s.surgeMatrix[mapKey]; exists {
		multiplier = liveMultiplier
	}
	s.mu.RUnlock()

	// Calculate final pricing allocation mapping using integer paise bounds to prevent data loss
	finalFarePaise := int64(float64(baseFarePaise) * multiplier)

	return finalFarePaise, multiplier
}

// Close cleanly releases network stream context resources
func (s *OrderPricingService) Close() error {
	return s.kafkaReader.Close()
}
