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
	trackerKey := fmt.Sprintf("driver:{%s}:current_cell:%s", loc.CityPrefix, loc.DriverID)

	nowEpoch := float64(time.Now().Unix())

	var previousCell string
	err := r.clusterClient.Watch(ctx, func(tx *redis.Tx) error {
		var err error
		previousCell, err = tx.Get(ctx, trackerKey).Result()
		if err != nil && err != redis.Nil {
			return err
		}

		_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			// 1. Set the granular driver availability status string
			pipe.Set(ctx, statusKey, "ONLINE_AVAILABLE", ttl)

			// 2. If previous cell differs from current, remove the driver from the old cell ZSET
			if previousCell != "" && previousCell != loc.H3Cell {
				oldZSetKey := fmt.Sprintf("drivers:zset:{%s}:%s", loc.CityPrefix, previousCell)
				pipe.ZRem(ctx, oldZSetKey, loc.DriverID)
			}

			// 3. Add driver to the H3 cell spatial ZSET index using the timestamp as the score
			pipe.ZAdd(ctx, spatialZSetKey, redis.Z{
				Score:  nowEpoch,
				Member: loc.DriverID,
			})

			// 4. Set a moving expiration on the ZSET cell index to prevent memory leak accumulation
			pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)

			// 5. Maintain the current cell tracker
			pipe.Set(ctx, trackerKey, loc.H3Cell, 24*time.Hour)

			return nil
		})
		return err
	}, trackerKey)

	if err != nil {
		return fmt.Errorf("redis cluster atomic slot update failed: %w", err)
	}

	loc.PreviousH3Cell = previousCell
	return nil
}
