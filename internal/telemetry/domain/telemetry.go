package domain

import (
	"context"
	"time"
)

// DriverLocation represents the internal normalized telemetry payload
type DriverLocation struct {
	DriverID                string    `json:"driver_id"`
	CityPrefix              string    `json:"city_prefix"`
	Latitude                float64   `json:"latitude"`
	Longitude               float64   `json:"longitude"`
	Bearing                 float32   `json:"bearing"`
	SpeedKMS                float32   `json:"speed_kms"`
	Timestamp               time.Time `json:"timestamp"`
	H3Cell                  string    `json:"h3_cell"`
	PreviousH3Cell          string    `json:"previous_h3_cell"`
	OSMNodeID               int64     `json:"osm_node_id"`
	AcceptanceRate          float32   `json:"acceptance_rate"`
	CancellationProbability float32   `json:"cancellation_probability"`
}

// DriverMetrics holds per-driver stats fetched from the relational store.
type DriverMetrics struct {
	OSMNodeID               int64
	AcceptanceRate          float32
	CancellationProbability float32
}

// DriverMetricsProvider fetches live driver metrics from the authoritative store.
type DriverMetricsProvider interface {
	GetDriverMetrics(ctx context.Context, driverID string) (*DriverMetrics, error)
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
