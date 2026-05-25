package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
)

type redisRepo struct {
	clusterClient *redis.ClusterClient
}

func NewRedisRepository(client *redis.ClusterClient) domain.RedisRepository {
	return &redisRepo{clusterClient: client}
}

func (r *redisRepo) SetDriverLocation(ctx context.Context, loc *domain.DriverLocation, ttl time.Duration) error {
	// Enforce Redis Hashtagging on the city prefix to route all regional operations to the same cluster slot
	// Pattern: {%s} wraps the hash-slot calculation token strictly to the city identifier
	statusKey := fmt.Sprintf("driver:{%s}:status:%s", loc.CityPrefix, loc.DriverID)
	spatialZSetKey := fmt.Sprintf("drivers:zset:{%s}:%s", loc.CityPrefix, loc.H3Cell)

	nowEpoch := float64(time.Now().Unix())

	// Execute an atomic multi-command pipeline within the same hash slot
	pipe := r.clusterClient.TxPipeline()

	// 1. Set the granular driver availability status string
	pipe.Set(ctx, statusKey, "ONLINE_AVAILABLE", ttl)

	// 2. Add driver to the H3 cell spatial ZSET index using the timestamp as the score
	pipe.ZAdd(ctx, spatialZSetKey, redis.Z{
		Score:  nowEpoch,
		Member: loc.DriverID,
	})

	// 3. Set a moving expiration on the ZSET cell index to prevent memory leak accumulation
	pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("redis cluster atomic slot update failed: %w", err)
	}
	return nil
}
