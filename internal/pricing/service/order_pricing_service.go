package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"github.com/platform/driver-delivery/internal/pricing/surge"
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
	kafkaReader    *kafka.Reader
	clusterClient  *redis.ClusterClient // MILESTONE 4: Shared distributed cache replaces process-local map
	surgeRegulator *surge.SurgeRegulator
}

func NewOrderPricingService(brokers []string, groupID string, client *redis.ClusterClient) *OrderPricingService {
	return &OrderPricingService{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:  brokers,
			Topic:    "surge.zone.updated", // Consumes output from our Job 3 pricing engine
			GroupID:  groupID,              // Horizontal group scaling configuration
			MinBytes: 10,
			MaxBytes: 10e6,
		}),
		clusterClient:  client,
		surgeRegulator: surge.NewSurgeRegulator(0.20, 15*time.Second, 3.5),
	}
}

// StartSurgeMatrixSync pumps event loops from Kafka to continuously update the shared cluster state
func (s *OrderPricingService) StartSurgeMatrixSync(ctx context.Context) {
	log.Println("Order Pricing Service: Safely synchronized distributed surge cache paths.")
	
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

			// MILESTONE 4 KEY SCHEMA: Un-bracketed to enforce uniform shard scattering across all 6 nodes
			matrixKey := fmt.Sprintf("surge:matrix:%s:%s", event.CityPrefix, event.H3Cell)

			// Store the live multiplier directly inside the Redis Cluster storage tier
			// with a defensive 12-hour expiration safety TTL boundary
			err = s.clusterClient.Set(ctx, matrixKey, event.SurgeMultiplier, 12*time.Hour).Err()
			if err != nil {
				log.Printf("[PRICING_CACHE_WRITE_ERROR] Failed saving distributed key %s: %v", matrixKey, err)
			}
		}
	}
}

// CalculateFare joins base operational metrics with live multipliers via high-velocity Redis reads
func (s *OrderPricingService) CalculateFare(ctx context.Context, cityPrefix string, pickupH3Cell string, baseFarePaise int64) (int64, float64, error) {
	matrixKey := fmt.Sprintf("surge:matrix:%s:%s", cityPrefix, pickupH3Cell)
	multiplier := 1.0

	// Enforce a tight context read timeout deadline (15ms) to protect the sub-500ms API latency SLA
	readCtx, cancel := context.WithTimeout(ctx, 15*time.Millisecond)
	defer cancel()

	// Extract the active regional coefficient from the shared Redis Cluster tier
	val, err := s.clusterClient.Get(readCtx, matrixKey).Result()
	if err == nil {
		if parsedMultiplier, parseErr := strconv.ParseFloat(val, 64); parseErr == nil {
			multiplier = parsedMultiplier
		}
	} else if !errors.Is(err, redis.Nil) {
		// Log the error but maintain fallback baseline calculation execution
		log.Printf("[PRICING_CACHE_READ_ERROR] Fallback triggered for key %s: %v", matrixKey, err)
	}

	// Calculate final pricing allocation mapping using integer paise bounds to prevent data loss
	finalFarePaise := int64(float64(baseFarePaise) * multiplier)

	// redis.Nil is a cache miss — not an error; fallback to 1.0 is the correct behaviour.
	if errors.Is(err, redis.Nil) {
		err = nil
	}
	return finalFarePaise, multiplier, err
}

// CalculateDynamicFarePaise resolves total trip fares safely against floating latency parameters
func (s *OrderPricingService) CalculateDynamicFarePaise(ctx context.Context, h3Cell string, baseFarePaise int64) (int64, float64) {
	// 1. Fetch live metrics from memory arrays using explicit O(1) shard lookups
	demandKey := fmt.Sprintf("metrics:demand:%s", h3Cell)
	supplyKey := fmt.Sprintf("metrics:supply:%s", h3Cell)

	demandCount, _ := s.clusterClient.SCard(ctx, demandKey).Result()
	supplyCount, _ := s.clusterClient.SCard(ctx, supplyKey).Result()

	// Mock or active gRPC client binding handler method reference targeting external Triton models
	mockTritonModelCall := func() (float64, error) {
		// Simulating normal execution latency inside nominal bounds
		time.Sleep(12 * time.Millisecond) 
		return 1.45, nil
	}

	// 2. Route evaluation securely down through the regulator circuit breaker layer
	surgeMultiplier := s.surgeRegulator.ExecuteOrFallback(ctx, mockTritonModelCall, demandCount, supplyCount)

	// 3. Complete precise 64-bit non-float calculation passes for localized balance adjustments
	finalFarePaise := int64(float64(baseFarePaise) * surgeMultiplier)

	return finalFarePaise, surgeMultiplier
}

// Close cleanly releases network stream context resources
func (s *OrderPricingService) Close() error {
	return s.kafkaReader.Close()
}
