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

// OrderCreatedEvent mirrors the core domain payload schema emitted from dispatch gates
type OrderCreatedEvent struct {
	OrderID      string  `json:"order_id"`
	CityPrefix   string  `json:"city_prefix"`
	CustomerID   string  `json:"customer_id"`
	PickupH3Cell string  `json:"pickup_h3_cell"`
	PickupLat    float64 `json:"pickup_lat"`
	PickupLng    float64 `json:"pickup_lng"`
	Timestamp    int64   `json:"timestamp_utc"`
}

type DemandAggregatorStream struct {
	kafkaReader   *kafka.Reader
	clusterClient *redis.ClusterClient
	windowSize    time.Duration
}

func NewDemandAggregatorStream(brokers []string, redisClient *redis.ClusterClient) *DemandAggregatorStream {
	return &DemandAggregatorStream{
		kafkaReader: kafka.NewReader(kafka.ReaderConfig{
			Brokers:        brokers,
			Topic:          "order.created", // Specified in section 06 topology table
			GroupID:        "surge-demand-aggregator-group",
			MinBytes:       10,
			MaxBytes:       10e6, // 10MB batch buffers
			CommitInterval: time.Second,
		}),
		clusterClient: redisClient,
		windowSize:    30 * time.Second, // 30-second sliding demand window constraint
	}
}

// StartDemandEngine begins the event loop pumping orders into the sliding metrics matrix
func (s *DemandAggregatorStream) StartDemandEngine(ctx context.Context) {
	log.Println("Surge Revenue Engine: Demand Aggregator active on topic: order.created...")

	for {
		select {
		case <-ctx.Done():
			log.Println("Gracefully terminating Surge Demand Aggregator streaming pipe.")
			return
		default:
			msg, err := s.kafkaReader.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Printf("Downstream pipeline error reading demand event: %v", err)
				continue
			}

			var event OrderCreatedEvent
			if err := json.Unmarshal(msg.Value, &event); err != nil {
				log.Printf("Dropped malformed surge demand telemetry record: %v", err)
				continue
			}

			// Pipeline payload immediately into Redis memory shards
			err = s.mutateRollingDemandWindow(ctx, event)
			if err != nil {
				log.Printf("[SURGE_METRICS_ERROR] Failed updating demand window for cell %s: %v", event.PickupH3Cell, err)
			}
		}
	}
}

func (s *DemandAggregatorStream) mutateRollingDemandWindow(ctx context.Context, event OrderCreatedEvent) error {
	// Enforce strict Redis Hashtagging to ensure slot alignment on regional cluster nodes
	// Target format matches supply structures: surge:demand:{city}:cellID
	redisKey := fmt.Sprintf("surge:demand:{%s}:%s", event.CityPrefix, event.PickupH3Cell)

	now := time.Now().Unix()
	expirationBoundary := now + int64(s.windowSize.Seconds())

	// Open transactional pipeline loop across cluster routing paths
	pipe := s.clusterClient.TxPipeline()

	// 1. Inject order creation identifier with forward-looking sliding timestamp score
	pipe.ZAdd(ctx, redisKey, redis.Z{
		Score:  float64(expirationBoundary),
		Member: event.OrderID,
	})

	// 2. Perform eviction of all stale indices sitting behind the present UNIX timeline
	pipe.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("(%d", now))

	// 3. Keep cache footprint alive for double the window lifecycle to preserve audit availability
	pipe.Expire(ctx, redisKey, s.windowSize*2)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("redis cluster pipeline atomic demand update failed: %w", err)
	}

	return nil
}

// GetRecentDemandRate returns the non-stale ride request speed within the active window
func (s *DemandAggregatorStream) GetRecentDemandRate(ctx context.Context, cityPrefix, h3Cell string) (int64, error) {
	redisKey := fmt.Sprintf("surge:demand:{%s}:%s", cityPrefix, h3Cell)
	now := time.Now().Unix()

	// Proactively drop trailing stale entries prior to cardinal evaluation
	_, _ = s.clusterClient.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("(%d", now)).Result()

	// Retrieve total distinct requests currently registered inside the Sorted Set
	count, err := s.clusterClient.ZCard(ctx, redisKey).Result()
	if err != nil {
		return 0, fmt.Errorf("failed counting sliding demand matrix: %w", err)
	}

	return count, nil
}

// Close cleanly releases the underlying streaming broker connection state
func (s *DemandAggregatorStream) Close() error {
	return s.kafkaReader.Close()
}
