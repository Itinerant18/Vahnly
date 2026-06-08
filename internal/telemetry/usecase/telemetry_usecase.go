package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/platform/driver-delivery/internal/telemetry/domain"
	"github.com/redis/go-redis/v9"
	"github.com/uber/h3-go/v3"
)

const RedisTelemetryChannel = "gateway:telemetry:broadcast"

type telemetryUseCase struct {
	redisRepo       domain.RedisRepository
	kafkaProducer   domain.KafkaProducer
	metricsProvider domain.DriverMetricsProvider
	clusterClient   *redis.ClusterClient // Injected to manage high-velocity telemetry multiplexing
	ttl             time.Duration
	regionRouter    *RegionRouter // INJECTED
}

func NewTelemetryUseCase(rr domain.RedisRepository, kp domain.KafkaProducer, mp domain.DriverMetricsProvider, client *redis.ClusterClient) domain.TelemetryUseCase {
	return &telemetryUseCase{
		redisRepo:       rr,
		kafkaProducer:   kp,
		metricsProvider: mp,
		clusterClient:   client,
		ttl:             30 * time.Second,
	}
}

// SetRegionRouter allows dynamic injection of the active-active region boundary checker
func (u *telemetryUseCase) SetRegionRouter(rr *RegionRouter) {
	u.regionRouter = rr
}

func (u *telemetryUseCase) ProcessLocationUpdate(ctx context.Context, loc *domain.DriverLocation) error {
	// 1. Check for Cross-Region boundaries FIRST
	if u.regionRouter != nil {
		err := u.regionRouter.DetectAndHandoff(ctx, *loc)
		if err != nil {
			fmt.Printf("failed to process region handoff: %v\n", err)
			// Non-fatal, continue processing
		}
	}

	// 2. Identify which region the coordinate belongs to and filter local ingestion
	if u.regionRouter != nil && u.regionRouter.resolveRegion(loc.Latitude, loc.Longitude) != u.regionRouter.currentRegion {
		// Driver belongs to another region now; skip local indexing
		return nil
	}

	// 3. Compute H3 Resolution 8 Index (~0.7 km² per cell)
	latRad := loc.Latitude * (math.Pi / 180.0)
	lngRad := loc.Longitude * (math.Pi / 180.0)
	centerCoord := h3.GeoCoord{Latitude: latRad, Longitude: lngRad}
	resolution8Cell := h3.FromGeo(centerCoord, 8)

	loc.H3Cell = h3.ToString(resolution8Cell)

	// 4. Enrich location with driver metrics
	if u.metricsProvider != nil {
		metrics, err := u.metricsProvider.GetDriverMetrics(ctx, loc.DriverID)
		if err != nil {
			fmt.Printf("Non-blocking driver metrics fetch failure for %s: %v\n", loc.DriverID, err)
		} else {
			loc.OSMNodeID = metrics.OSMNodeID
			loc.AcceptanceRate = metrics.AcceptanceRate
			loc.CancellationProbability = metrics.CancellationProbability
		}
	}

	// 5. Write to Redis Cluster using pipeline tracking layout
	if err := u.redisRepo.SetDriverLocation(ctx, loc, u.ttl); err != nil {
		return fmt.Errorf("failed tracking cache allocation: %w", err)
	}

	// Index in region's Geo ZSET if regionRouter is set (for Stage 8 active-active validations)
	if u.regionRouter != nil && u.clusterClient != nil {
		_ = u.clusterClient.GeoAdd(ctx, "driver:locations:"+u.regionRouter.currentRegion, &redis.GeoLocation{
			Name:      loc.DriverID,
			Longitude: loc.Longitude,
			Latitude:  loc.Latitude,
		}).Err()
	}

	// MILESTONE 20 LIVE STREAM FORK: Check if the driver is active on an in-progress trip
	if u.clusterClient != nil {
		go func(dID string, lat, lng float64) {
			forkCtx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()

			activeTripKey := fmt.Sprintf("driver:active:trip:%s", dID)
			orderID, err := u.clusterClient.Get(forkCtx, activeTripKey).Result()

			// If an active lease is found, broadcast coordinates down the Pub/Sub backplane channel
			if err == nil && orderID != "" {
				telemetryPayload := map[string]interface{}{
					"order_id":  orderID,
					"driver_id": dID,
					"latitude":  lat,
					"longitude": lng,
					"timestamp": time.Now().Unix(),
				}
				bytes, mErr := json.Marshal(telemetryPayload)
				if mErr == nil {
					_ = u.clusterClient.Publish(forkCtx, RedisTelemetryChannel, string(bytes)).Err()
				}
			}
		}(loc.DriverID, loc.Latitude, loc.Longitude)
	}

	// 6. Fire asynchronous event down the shared Kafka Backbone
	if err := u.kafkaProducer.PublishLocationUpdate(ctx, loc); err != nil {
		fmt.Printf("Non-blocking downstream Kafka producer failure: %v\n", err)
	}

	return nil
}
