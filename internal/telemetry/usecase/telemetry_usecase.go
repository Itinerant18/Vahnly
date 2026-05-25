package usecase

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/uber/h3-go/v3" // Official Uber H3 spatial index library [cite: 12, 107]
	"github.com/platform/driver-delivery/internal/telemetry/domain"
)

type telemetryUseCase struct {
	redisRepo     domain.RedisRepository
	kafkaProducer domain.KafkaProducer
	ttl           time.Duration
}

func NewTelemetryUseCase(rr domain.RedisRepository, kp domain.KafkaProducer) domain.TelemetryUseCase {
	return &telemetryUseCase{
		redisRepo:     rr,
		kafkaProducer: kp,
		ttl:           30 * time.Second, // 30-second TTL per architectural mandate [cite: 26, 38]
	}
}

func (u *telemetryUseCase) ProcessLocationUpdate(ctx context.Context, loc *domain.DriverLocation) error {
	// 1. Compute H3 Resolution 8 Index (~0.7 km² per cell) [cite: 25]
	// H3 library expects coordinates in radians, not decimal degrees.
	latRad := loc.Latitude * (math.Pi / 180.0)
	lngRad := loc.Longitude * (math.Pi / 180.0)
	centerCoord := h3.GeoCoord{Latitude: latRad, Longitude: lngRad}
	resolution8Cell := h3.FromGeo(centerCoord, 8)
	
	loc.H3Cell = h3.ToString(resolution8Cell)

	// 2. Write to Redis Cluster using pipeline tracking layout 
	if err := u.redisRepo.SetDriverLocation(ctx, loc, u.ttl); err != nil {
		return fmt.Errorf("failed tracking cache allocation: %w", err)
	}

	// 3. Fire asynchronous event down the shared Kafka Backbone [cite: 34, 73]
	if err := u.kafkaProducer.PublishLocationUpdate(ctx, loc); err != nil {
		// Log error internally but do not block client responses; keeps ingestion sub-500ms [cite: 2, 94]
		fmt.Printf("Non-blocking downstream Kafka producer failure: %v\n", err)
	}

	return nil
}
