package domain

import (
	"context"
	"time"
)

// DriverLocation represents the internal normalized telemetry payload
type DriverLocation struct {
	DriverID   string    `json:"driver_id"`
	CityPrefix string    `json:"city_prefix"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	Bearing    float32   `json:"bearing"`
	SpeedKMS   float32   `json:"speed_kms"`
	Timestamp  time.Time `json:"timestamp"`
	H3Cell     string    `json:"h3_cell"`
}

// RedisRepository defines memory cache transactions for active driver state
type RedisRepository interface {
	SetDriverLocation(ctx context.Context, loc *DriverLocation, ttl time.Duration) error
}

// KafkaProducer defines the contract to publish spatial events down the pipeline
type KafkaProducer interface {
	PublishLocationUpdate(ctx context.Context, loc *DriverLocation) error
}

// TelemetryUseCase defines the business routing engine orchestrating ingestion rules
type TelemetryUseCase interface {
	ProcessLocationUpdate(ctx context.Context, loc *DriverLocation) error
}
