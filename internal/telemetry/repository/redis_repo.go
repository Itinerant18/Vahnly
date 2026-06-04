package repository

import (
	"context"
	"fmt"
	"strconv"
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
	// Group driver-specific keys by DriverID to distribute load across all shards
	statusKey  := fmt.Sprintf("driver:{%s:%s}:status",       loc.CityPrefix, loc.DriverID)
	trackerKey := fmt.Sprintf("driver:{%s:%s}:current_cell", loc.CityPrefix, loc.DriverID)
	profileKey := fmt.Sprintf("driver:{%s:%s}:profile",      loc.CityPrefix, loc.DriverID)

	// Spatial index ZSET keys are single-key structures that don't need driver-level hashtagging
	spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", loc.CityPrefix, loc.H3Cell)
	nowEpoch := float64(time.Now().Unix())

	// 1. Read previousCell INSIDE the WATCH scope so we observe a consistent snapshot.
	//    Reading it outside would create a TOCTOU window: a concurrent update could change
	//    trackerKey between our GET and the WATCH, making ZRem target a phantom cell.
	var previousCell string

	err := r.clusterClient.Watch(ctx, func(tx *redis.Tx) error {
		var watchErr error
		previousCell, watchErr = tx.Get(ctx, trackerKey).Result()
		if watchErr != nil && watchErr != redis.Nil {
			return fmt.Errorf("failed fetching tracker history node: %w", watchErr)
		}

		_, watchErr = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(ctx, statusKey, "ONLINE_AVAILABLE", ttl)
			pipe.Set(ctx, trackerKey, loc.H3Cell, 24*time.Hour)
			// Write driver-owned profile fields (set unconditionally on every location update).
			pipe.HSet(ctx, profileKey,
				"osm_node_id",              strconv.FormatInt(loc.OSMNodeID, 10),
				"acceptance_rate",          strconv.FormatFloat(float64(loc.AcceptanceRate), 'f', 6, 32),
				"cancellation_probability", strconv.FormatFloat(float64(loc.CancellationProbability), 'f', 6, 32),
				"speed_kms",                strconv.FormatFloat(float64(loc.SpeedKMS), 'f', 2, 32),
				"bearing",                  strconv.FormatFloat(float64(loc.Bearing), 'f', 2, 32),
				"last_ping_utc",            time.Now().Format(time.RFC3339),
			)
			// is_inside_surge_zone and idle_seconds are owned by the surge aggregator.
			// Use HSetNX so we write a safe default only on first creation, never overwriting
			// a live surge-zone flag that was set by the aggregator.
			pipe.HSetNX(ctx, profileKey, "is_inside_surge_zone", "0")
			pipe.HSetNX(ctx, profileKey, "idle_seconds", "0.0")
			pipe.Expire(ctx, profileKey, 24*time.Hour)
			return nil
		})
		return watchErr
	}, trackerKey)

	if err != nil {
		return fmt.Errorf("driver profile slot transaction failed: %w", err)
	}

	// 2. Update spatial indexes. Single-key ZSET commands are atomic
	// and scatter uniformly across cluster shards without CROSSSLOT errors.
	pipe := r.clusterClient.Pipeline()

	if previousCell != "" && previousCell != loc.H3Cell {
		oldZSetKey := fmt.Sprintf("drivers:zset:%s:%s", loc.CityPrefix, previousCell)
		pipe.ZRem(ctx, oldZSetKey, loc.DriverID)
	}

	pipe.ZAdd(ctx, spatialZSetKey, redis.Z{Score: nowEpoch, Member: loc.DriverID})
	pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)

	if _, err = pipe.Exec(ctx); err != nil {
		return fmt.Errorf("spatial index scatter pipeline failed: %w", err)
	}

	loc.PreviousH3Cell = previousCell
	return nil
}
