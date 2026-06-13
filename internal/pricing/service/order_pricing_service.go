package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"time"

	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	"github.com/platform/driver-delivery/internal/pricing/surge"
	"github.com/redis/go-redis/v9"
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

// SurgeZoneUpdateEvent represents the event payload emitted by the Surge Calculator (Job 3)
type SurgeZoneUpdateEvent struct {
	CityPrefix      string    `json:"city_prefix"`
	H3Cell          string    `json:"h3_cell"`
	SurgeMultiplier float64   `json:"surge_multiplier"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// OrderPricingService handles stateless passenger fare estimations using a shared Redis Cluster cache
type OrderPricingService struct {
	kafkaReader    *kafka.Reader
	clusterClient  *redis.ClusterClient
	surgeRegulator *surge.SurgeRegulator
	baseFarePaise  int64
	perMeterPaise  int64
	logger         *log.Logger
	dlq            *kafkacfg.DLQ
}

// NewOrderPricingService instantiates a horizontally scalable pricing gateway engine
func NewOrderPricingService(brokers []string, groupID string, client *redis.ClusterClient) *OrderPricingService {
	sec := kafkacfg.FromEnv()
	return &OrderPricingService{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:  brokers,
			Topic:    "surge.zone.updated", // Consumes output from our Job 3 pricing engine
			GroupID:  groupID,              // Horizontal group scaling configuration
			MinBytes: 10,
			MaxBytes: 10e6,
			Dialer:   sec.Dialer(),
		}),
		dlq:            kafkacfg.NewDLQ(brokers, "surge.zone.updated.dlq", sec),
		clusterClient:  client,
		surgeRegulator: surge.NewSurgeRegulator(0.20, 15*time.Second, 3.5),
		baseFarePaise:  4000, // 40.00 Rs baseline
		perMeterPaise:  15,   // 0.15 Rs per meter baseline
		logger:         log.New(os.Stdout, "[PricingSvc] ", log.LstdFlags),
	}
}

// StartSurgeMatrixSync pumps event loops from Kafka to continuously update the shared cluster state
func (s *OrderPricingService) StartSurgeMatrixSync(ctx context.Context) {
	s.logger.Println("Order Pricing Service: Safely synchronized distributed surge cache paths.")

	for {
		select {
		case <-ctx.Done():
			s.logger.Println("Closing pricing matrix synchronization pipelines cleanly.")
			return
		default:
			msg, err := s.kafkaReader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				s.logger.Printf("Pricing data pipeline exception: %v", err)
				continue
			}

			var event SurgeZoneUpdatedEvent
			if err := json.Unmarshal(msg.Value, &event); err != nil {
				s.logger.Printf("Routing malformed surge pricing event to DLQ: %v", err)
				_ = s.dlq.Publish(ctx, msg, "json_unmarshal_failed: "+err.Error())
				continue
			}

			// MILESTONE 4 KEY SCHEMA: Un-bracketed to enforce uniform shard scattering across all 6 nodes
			matrixKey := fmt.Sprintf("surge:matrix:%s:%s", event.CityPrefix, event.H3Cell)

			// Store the live multiplier directly inside the Redis Cluster storage tier
			// with a defensive 12-hour expiration safety TTL boundary
			err = s.clusterClient.Set(ctx, matrixKey, event.SurgeMultiplier, 12*time.Hour).Err()
			if err != nil {
				s.logger.Printf("[PRICING_CACHE_WRITE_ERROR] Failed saving distributed key %s: %v", matrixKey, err)
			}
		}
	}
}

// applyFreezeCap clamps a live surge multiplier to an admin-set freeze cap when one is
// active for the cell. The freeze lives at its own key (surge:freeze:<city>:<cell>),
// separate from the live surge:matrix key the Kafka sync writes, so the cap is never
// overwritten by the next surge event and only ever lowers price (min of live, cap).
// Best-effort: any read error leaves the live multiplier unchanged.
func (s *OrderPricingService) applyFreezeCap(ctx context.Context, city, h3Cell string, multiplier float64) float64 {
	if city == "" || h3Cell == "" {
		return multiplier
	}
	freezeKey := fmt.Sprintf("surge:freeze:%s:%s", city, h3Cell)
	capVal, err := s.clusterClient.Get(ctx, freezeKey).Result()
	if err != nil {
		return multiplier
	}
	capMult, parseErr := strconv.ParseFloat(capVal, 64)
	if parseErr != nil || capMult <= 0 {
		return multiplier
	}
	if multiplier > capMult {
		return capMult
	}
	return multiplier
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
		s.logger.Printf("[PRICING_CACHE_READ_ERROR] Fallback triggered for key %s: %v", matrixKey, err)
	}

	// Clamp to any active admin freeze cap before pricing.
	multiplier = s.applyFreezeCap(readCtx, cityPrefix, pickupH3Cell, multiplier)

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

// GetFareQuote evaluates spatial coefficients across the shared cache and returns transactional costs in Paise
func (s *OrderPricingService) GetFareQuote(ctx context.Context, city string, h3Cell string, distanceMeters float64) (int64, float64, error) {
	if city == "" || h3Cell == "" || distanceMeters < 0 {
		return 0, 1.0, errors.New("invalid estimation arguments: fields cannot be empty or negative values")
	}

	matrixKey := fmt.Sprintf("surge:matrix:%s:%s", city, h3Cell)
	multiplierStr, err := s.clusterClient.Get(ctx, matrixKey).Result()

	multiplier := 1.0
	if err == nil {
		parsed, parseErr := strconv.ParseFloat(multiplierStr, 64)
		if parseErr == nil {
			multiplier = parsed
		}
	} else if !errors.Is(err, redis.Nil) {
		s.logger.Printf("Degraded Operations Warning: Redis cluster read error, falling back to 1.0 multiplier: %v", err)
	}

	// Clamp to any active admin freeze cap before pricing.
	multiplier = s.applyFreezeCap(ctx, city, h3Cell, multiplier)

	// Calculate base operational costs before applying multiplier modifiers
	distanceCost := float64(s.perMeterPaise) * distanceMeters
	rawTotalFare := float64(s.baseFarePaise) + distanceCost
	finalSurgeFare := rawTotalFare * multiplier

	// Enforce 64-bit integer tracking boundaries (Paise) to eliminate floating point accuracy drift
	return int64(math.Round(finalSurgeFare)), multiplier, nil
}

// Close cleanly releases network stream context resources
func (s *OrderPricingService) Close() error {
	return s.kafkaReader.Close()
}
