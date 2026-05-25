package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9" // Standard high-performance Redis cluster driver [cite: 107]
	"github.com/platform/driver-delivery/internal/telemetry/domain"
)

type redisRepo struct {
	clusterClient *redis.ClusterClient
}

func NewRedisRepository(client *redis.ClusterClient) domain.RedisRepository {
	return &redisRepo{clusterClient: client}
}

func (r *redisRepo) SetDriverLocation(ctx context.Context, loc *domain.DriverLocation, ttl time.Duration) error {
	// Format key according to specification: driver:{city}:{h3_cell}:{driver_id} [cite: 26]
	key := fmt.Sprintf("driver:%s:%s:%s", loc.CityPrefix, loc.H3Cell, loc.DriverID)

	// Set string values tracking standard ONLINE_AVAILABLE driver state profiles [cite: 26, 38]
	err := r.clusterClient.Set(ctx, key, "ONLINE_AVAILABLE", ttl).Err()
	if err != nil {
		return fmt.Errorf("redis cluster routing write error: %w", err)
	}
	return nil
}
