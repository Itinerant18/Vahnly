package usecase_test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/telemetry/domain"
	"github.com/platform/driver-delivery/internal/telemetry/usecase"
	"github.com/uber/h3-go/v3"
)

type mockRedisRepo struct {
	SetLocationFunc func(ctx context.Context, loc *domain.DriverLocation, ttl time.Duration) error
}

func (m *mockRedisRepo) SetDriverLocation(ctx context.Context, loc *domain.DriverLocation, ttl time.Duration) error {
	if m.SetLocationFunc != nil {
		return m.SetLocationFunc(ctx, loc, ttl)
	}
	return nil
}

type mockKafkaProducer struct {
	PublishFunc func(ctx context.Context, loc *domain.DriverLocation) error
}

func (m *mockKafkaProducer) PublishLocationUpdate(ctx context.Context, loc *domain.DriverLocation) error {
	if m.PublishFunc != nil {
		return m.PublishFunc(ctx, loc)
	}
	return nil
}

func TestProcessLocationUpdate_RadianConversion(t *testing.T) {
	// 1. Setup mock repository and producer
	var savedLocation *domain.DriverLocation
	repo := &mockRedisRepo{
		SetLocationFunc: func(ctx context.Context, loc *domain.DriverLocation, ttl time.Duration) error {
			savedLocation = loc
			return nil
		},
	}
	producer := &mockKafkaProducer{}

	uc := usecase.NewTelemetryUseCase(repo, producer, nil, nil)

	// 2. Define input with decimal degrees
	lat := 22.5726
	lng := 88.3639
	loc := &domain.DriverLocation{
		DriverID:   "driver-1",
		CityPrefix: "CCU",
		Latitude:   lat,
		Longitude:  lng,
		Timestamp:  time.Now(),
	}

	// 3. Process the location
	err := uc.ProcessLocationUpdate(context.Background(), loc)
	if err != nil {
		t.Fatalf("Failed to process location update: %v", err)
	}

	// 4. Compute expected H3 index using correct radian formula
	latRad := lat * (math.Pi / 180.0)
	lngRad := lng * (math.Pi / 180.0)
	expectedCell := h3.ToString(h3.FromGeo(h3.GeoCoord{Latitude: latRad, Longitude: lngRad}, 8))

	if savedLocation.H3Cell != expectedCell {
		t.Errorf("Expected H3Cell %s, got %s", expectedCell, savedLocation.H3Cell)
	}
}
