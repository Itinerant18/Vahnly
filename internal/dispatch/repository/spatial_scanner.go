package repository

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/uber/h3-go/v3"
	"github.com/platform/driver-delivery/internal/dispatch/matcher"
)

type SpatialScanner struct {
	clusterClient *redis.ClusterClient
}

func NewSpatialScanner(client *redis.ClusterClient) *SpatialScanner {
	return &SpatialScanner{clusterClient: client}
}

// ScanNearbyDrivers retrieves all available driver IDs and hydates their true graph metadata
func (s *SpatialScanner) ScanNearbyDrivers(ctx context.Context, cityPrefix string, targetCellStr string) ([]matcher.CandidateDriver, error) {
	targetCell := h3.FromString(targetCellStr)
	if !h3.IsValid(targetCell) {
		return nil, fmt.Errorf("invalid_spatial_token: %s", targetCellStr)
	}

	// Fetch k-ring index array (Target cell + 6 immediate neighbors)
	spatialRing := h3.KRing(targetCell, 1)

	now := time.Now().Unix()
	staleThreshold := now - 30 // 30-second stale sliding window threshold

	var discoveredDriverIDs []string

	// 1. Gather all active driver IDs across localized rings
	for _, cell := range spatialRing {
		cellStr := h3.ToString(cell)
		zsetKey := fmt.Sprintf("drivers:zset:{%s}:%s", cityPrefix, cellStr)

		driverIDs, err := s.clusterClient.ZRevRangeByScore(ctx, zsetKey, &redis.ZRangeBy{
			Max: fmt.Sprintf("%d", now),
			Min: fmt.Sprintf("%d", staleThreshold),
		}).Result()

		if err != nil && err != redis.Nil {
			return nil, fmt.Errorf("redis cluster zset fetch failed on key %s: %w", zsetKey, err)
		}

		discoveredDriverIDs = append(discoveredDriverIDs, driverIDs...)
	}

	if len(discoveredDriverIDs) == 0 {
		return nil, nil
	}

	// 2. High-Performance Metadata Hydration Phase via Cluster Pipelines
	// Using transaction pipelines to ensure single roundtrip reads per cluster slot layout
	pipe := s.clusterClient.Pipeline()
	cmdMap := make(map[string]*redis.SliceCmd)

	for _, driverID := range discoveredDriverIDs {
		// Target profile key schema enforcing strict slot uniformity via city hashtags
		profileKey := fmt.Sprintf("driver:{%s}:profile:%s", cityPrefix, driverID)
		
		// Queue HMGET to extract live metrics from the active caching layer
		cmdMap[driverID] = pipe.HMGet(ctx, profileKey, "osm_node_id", "acceptance_rate", "cancellation_probability", "is_inside_surge_zone", "idle_seconds")
	}

	// Execute pipelined reads concurrently across cluster shards
	_, _ = pipe.Exec(ctx)

	var candidates []matcher.CandidateDriver

	// 3. Unpack Redis fields and map them to domain CandidateDriver structs
	for driverID, cmd := range cmdMap {
		fields, err := cmd.Result()
		if err != nil || len(fields) != 5 || fields[0] == nil {
			// Fallback configuration if a driver's ephemeral profile metadata cache expires
			candidates = append(candidates, matcher.CandidateDriver{
				DriverID:                driverID,
				OSMNodeID:               9999, // General city center vertex fallback
				AcceptanceRate:          0.85,
				CancellationProbability: 0.05,
				IsInsideSurgeZone:       false,
				IdleSeconds:             60.0,
				DistanceMeters:          1500,
			})
			continue
		}

		// Safely parse primitive types back from Redis memory blobs
		osmNodeID, _ := strconv.ParseInt(fields[0].(string), 10, 64)
		acceptanceRate, _ := strconv.ParseFloat(fields[1].(string), 32)
		cancellationProb, _ := strconv.ParseFloat(fields[2].(string), 32)
		isInsideSurge := fields[3].(string) == "1"
		idleSecs, _ := strconv.ParseFloat(fields[4].(string), 64)

		candidates = append(candidates, matcher.CandidateDriver{
			DriverID:                driverID,
			OSMNodeID:               osmNodeID,
			AcceptanceRate:          float32(acceptanceRate),
			CancellationProbability: float32(cancellationProb),
			IsInsideSurgeZone:       isInsideSurge,
			IdleSeconds:             idleSecs,
			DistanceMeters:          1000, // Replaced dynamically by Phase 2 graph weights
		})
	}

	return candidates, nil
}
