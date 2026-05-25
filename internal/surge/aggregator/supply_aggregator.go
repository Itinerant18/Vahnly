package aggregator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

type DriverStateChangedEvent struct {
	DriverID      string    `json:"driver_id"`
	CityPrefix    string    `json:"city_prefix"`
	PreviousState string    `json:"previous_state"`
	CurrentState  string    `json:"current_state"`
	H3Cell        string    `json:"h3_cell"`
	Timestamp     time.Time `json:"timestamp"`
}

type SupplyAggregatorStream struct {
	kafkaReader   *kafka.Reader
	clusterClient *redis.ClusterClient
	windowSize    time.Duration
}

func NewSupplyAggregatorStream(brokers []string, redisClient *redis.ClusterClient) *SupplyAggregatorStream {
	return &SupplyAggregatorStream{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:  brokers,
			Topic:    "driver.state.changed", // Core state change topic
			GroupID:  "surge-supply-aggregator-group",
			MinBytes: 10,
			MaxBytes: 10e6,
		}),
		clusterClient: redisClient,
		windowSize:    30 * time.Second, // 30-second aggregations
	}
}

// StartAggregationEngine pumps events from Kafka to update sliding window metrics
func (s *SupplyAggregatorStream) StartAggregationEngine(ctx context.Context) {
	log.Println("Surge Pricing Supply Aggregator Stream actively consuming driver.state.changed...")

	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := s.kafkaReader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Printf("Error pulling event from stream backbone: %v", err)
				continue
			}

			var event DriverStateChangedEvent
			if err := json.Unmarshal(msg.Value, &event); err != nil {
				log.Printf("Dropped unparseable surge telemetry packet: %v", err)
				continue
			}

			// Process event if it affects localized supply availability metrics
			if event.PreviousState == "ONLINE_AVAILABLE" || event.CurrentState == "ONLINE_AVAILABLE" {
				err := s.mutateRollingSupplyWindow(ctx, event)
				if err != nil {
					log.Printf("Failed tracking sliding window state: %v", err)
				}
			}
		}
	}
}

func (s *SupplyAggregatorStream) mutateRollingSupplyWindow(ctx context.Context, event DriverStateChangedEvent) error {
	// Build a predictable, slot-safe Redis key using hashtags
	// Target layout: surge:supply:{city}:cellID
	redisKey := fmt.Sprintf("surge:supply:{%s}:%s", event.CityPrefix, event.H3Cell)
	
	now := time.Now().Unix()
	windowExpiration := now + int64(s.windowSize.Seconds())

	pipe := s.clusterClient.TxPipeline()

	// Use a sorted set where member is the unique DriverID and score is the expiration timestamp
	if event.CurrentState == "ONLINE_AVAILABLE" {
		// Driver entered the available pool: register them with a forward timestamp score
		pipe.ZAdd(ctx, redisKey, redis.Z{
			Score:  float64(windowExpiration),
			Member: event.DriverID,
		})
	} else {
		// Driver left the available pool (assigned or offline): remove them immediately
		pipe.ZRem(ctx, redisKey, event.DriverID)
	}

	// Clean out any stale entries across the historical window boundary
	pipe.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("(%d)", now))
	
	// Keep the cache key alive for twice the window size to prevent data gaps
	pipe.Expire(ctx, redisKey, s.windowSize*2)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to commit sliding surge window mutation: %w", err)
	}

	return nil
}

// GetAvailableDriverCount returns the active, non-stale driver count for a given cell
func (s *SupplyAggregatorStream) GetAvailableDriverCount(ctx context.Context, cityPrefix, h3Cell string) (int64, error) {
	redisKey := fmt.Sprintf("surge:supply:{%s}:%s", cityPrefix, h3Cell)
	now := time.Now().Unix()

	// Clear out trailing stale records before counting
	_, _ = s.clusterClient.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("(%d)", now)).Result()

	// Count the remaining valid members inside the ZSET matrix
	count, err := s.clusterClient.ZCard(ctx, redisKey).Result()
	if err != nil {
		return 0, err
	}

	return count, nil
}
