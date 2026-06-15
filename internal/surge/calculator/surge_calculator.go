package calculator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/platform/driver-delivery/internal/messaging/kafkacfg"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

// SurgeZoneUpdatedEvent defines the transaction payload published down the pipeline
type SurgeZoneUpdatedEvent struct {
	H3Cell          string    `json:"h3_cell"`
	CityPrefix      string    `json:"city_prefix"`
	SurgeMultiplier float64   `json:"surge_multiplier"`
	DemandCount     int64     `json:"demand_count"`
	SupplyCount     int64     `json:"supply_count"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type SurgeCalculatorEngine struct {
	clusterClient *redis.ClusterClient
	kafkaWriter   *kafka.Writer
	evalInterval  time.Duration
	maxSurgeCap   float64
}

func NewSurgeCalculatorEngine(brokers []string, redisClient *redis.ClusterClient) *SurgeCalculatorEngine {
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        "surge.zone.updated", // Defined in Section 06 topic topology
		Balancer:     &kafka.Hash{},        // Partitioned by city prefix hash
		RequiredAcks: kafka.RequireOne,     // Ensures low latency while preserving delivery durability
	}
	kafkacfg.FromEnv().ApplyToWriter(w)
	return &SurgeCalculatorEngine{
		clusterClient: redisClient,
		kafkaWriter:   w,
		evalInterval:  5 * time.Second, // Evaluates and flushes pricing grids every 5 seconds
		maxSurgeCap:   4.5,             // Hard safety cap preventing extreme pricing edge anomalies
	}
}

// StartCalculatorLoop initiates the ticker engine managing rolling evaluation epochs
func (e *SurgeCalculatorEngine) StartCalculatorLoop(ctx context.Context, cityPrefix string, trackedCells []string) {
	log.Printf("Starting Surge Pricing Calculator loop for city [%s]. Managing %d zones.", cityPrefix, len(trackedCells))
	ticker := time.NewTicker(e.evalInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("Halting Surge Calculator worker thread for city %s.", cityPrefix)
			return
		case <-ticker.C:
			// Execute evaluation epoch across all regional spatial zones
			e.evaluateCitySurgeGrid(ctx, cityPrefix, trackedCells)
		}
	}
}

func (e *SurgeCalculatorEngine) evaluateCitySurgeGrid(ctx context.Context, cityPrefix string, cells []string) {
	// Create short execution context to safeguard sub-500ms operational SLAs
	epochCtx, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
	defer cancel()

	nowEpoch := time.Now().Unix()

	var wg sync.WaitGroup
	for _, cell := range cells {
		wg.Add(1)
		go func(c string) {
			defer wg.Done()

			// Build slot-aligned Redis keys matching Job 1 and Job 2 telemetry outputs
			supplyKey := fmt.Sprintf("surge:supply:{%s}:%s", cityPrefix, c)
			demandKey := fmt.Sprintf("surge:demand:{%s}:%s", cityPrefix, c)

			// 1. Evict stale window points and read current metric cardinality in parallel via multi-command pipeline
			pipe := e.clusterClient.Pipeline()
			pipe.ZRemRangeByScore(epochCtx, supplyKey, "-inf", fmt.Sprintf("(%d", nowEpoch))
			pipe.ZRemRangeByScore(epochCtx, demandKey, "-inf", fmt.Sprintf("(%d", nowEpoch))
			supplyCountCmd := pipe.ZCard(epochCtx, supplyKey)
			demandCountCmd := pipe.ZCard(epochCtx, demandKey)

			_, err := pipe.Exec(epochCtx)
			if err != nil {
				log.Printf("[SURGE_CALC_ERROR] Redis metric collection failed on cell %s: %v", c, err)
				return
			}

			supplyCount := supplyCountCmd.Val()
			demandRate := demandCountCmd.Val()

			// 2. Apply Enterprise Surge Multiplier Matrix Formula
			multiplier := 1.0

			if demandRate > 0 {
				// Defend against division-by-zero bounds when active supply matches 0
				effectiveSupply := float64(supplyCount)
				if effectiveSupply == 0 {
					effectiveSupply = 0.5 // Standard math friction stabilizer
				}

				// Formula calculation: max(1.0, demand_rate / (supply_count * 0.7))
				computedMultiplier := float64(demandRate) / (effectiveSupply * 0.7)

				// Enforce lower bound (1.0) and our maximum safety multiplier cap
				multiplier = math.Max(1.0, computedMultiplier)
				if multiplier > e.maxSurgeCap {
					multiplier = e.maxSurgeCap
				}
			}

			// Round metric float values to 2 decimal points for clean API delivery mapping
			multiplier = math.Round(multiplier*100) / 100

			// 3. Emit pricing update token down the Kafka Backbone if surge state presents adjustments
			err = e.publishSurgeUpdate(epochCtx, cityPrefix, c, multiplier, demandRate, supplyCount)
			if err != nil {
				log.Printf("[SURGE_PUBLISH_ERROR] Stream dispatch failed for zone %s: %v", c, err)
			}
		}(cell)
	}

	wg.Wait()
}

func (e *SurgeCalculatorEngine) publishSurgeUpdate(ctx context.Context, city, cell string, multiplier float64, demand, supply int64) error {
	eventPayload := SurgeZoneUpdatedEvent{
		H3Cell:          cell,
		CityPrefix:      city,
		SurgeMultiplier: multiplier,
		DemandCount:     demand,
		SupplyCount:     supply,
		UpdatedAt:       time.Now(),
	}

	serializedBytes, err := json.Marshal(eventPayload)
	if err != nil {
		return fmt.Errorf("failed pricing matrix encoding serialization: %w", err)
	}

	// Route message utilizing city-prefix key hashing to preserve partition ordering topology rules
	err = e.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(city),
		Value: serializedBytes,
	})
	if err != nil {
		return fmt.Errorf("kafka pricing log persistence write failure: %w", err)
	}

	return nil
}

// Close gracefully flushes down buffered network logs and disconnects stream endpoints
func (e *SurgeCalculatorEngine) Close() error {
	return e.kafkaWriter.Close()
}
