package repository

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/platform/driver-delivery/internal/dispatch/matcher"
	"github.com/redis/go-redis/v9"
	"github.com/uber/h3-go/v3"
)

type SpatialScanner struct {
	clusterClient *redis.ClusterClient
}

func NewSpatialScanner(client *redis.ClusterClient) *SpatialScanner {
	return &SpatialScanner{clusterClient: client}
}

// ScanNearbyDrivers retrieves all available driver IDs and hydrates their true graph metadata
func (s *SpatialScanner) ScanNearbyDrivers(ctx context.Context, cityPrefix string, targetCellStr string) ([]matcher.CandidateDriver, error) {
	targetCell := h3.FromString(targetCellStr)
	if !h3.IsValid(targetCell) {
		return nil, fmt.Errorf("invalid_spatial_token: %s", targetCellStr)
	}
	if s.clusterClient == nil {
		return nil, fmt.Errorf("redis_cluster_client_unavailable")
	}

	now := time.Now().Unix()
	staleThreshold := now - 30 // 30-second stale sliding window threshold

	discoveredDriverCells := make(map[string]string)

	// MILESTONE 2: Unified cluster pipeline — driver IDs + surge metric cardinalities in single roundtrip
	type cellSurgeCommands struct {
		driverIDsCmd *redis.StringSliceCmd
		supplyCmd    *redis.IntCmd
		demandCmd    *redis.IntCmd
	}

	// Surge counts accumulate across whatever rings we end up scanning.
	cellSupplyCount := make(map[string]int64)
	cellDemandCount := make(map[string]int64)

	// Progressive ring expansion: start at the immediate k=1 neighborhood and widen
	// until candidates are found or maxRingExpansion is reached. Previously the scan
	// stopped at k=1 and returned no driver when that ring was empty, silently failing
	// bookings in sparse cells even when supply sat one or two rings out.
	const maxRingExpansion = 3
	for k := 1; k <= maxRingExpansion; k++ {
		spatialRing := h3.KRing(targetCell, k)

		surgePipe := s.clusterClient.Pipeline()
		cellCmds := make(map[string]cellSurgeCommands, len(spatialRing))

		for _, cell := range spatialRing {
			cellStr := h3.ToString(cell)
			zsetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, cellStr)
			supplyKey := fmt.Sprintf("surge:supply:{%s}:%s", cityPrefix, cellStr)
			demandKey := fmt.Sprintf("surge:demand:{%s}:%s", cityPrefix, cellStr)

			cellCmds[cellStr] = cellSurgeCommands{
				driverIDsCmd: surgePipe.ZRevRangeByScore(ctx, zsetKey, &redis.ZRangeBy{
					Max: fmt.Sprintf("%d", now),
					Min: fmt.Sprintf("%d", staleThreshold),
				}),
				supplyCmd: surgePipe.ZCard(ctx, supplyKey),
				demandCmd: surgePipe.ZCard(ctx, demandKey),
			}
		}

		if _, err := surgePipe.Exec(ctx); err != nil && err != redis.Nil {
			log.Printf("[SPATIAL_SCANNER] surge pipeline exec error (k=%d): %v", k, err)
		}

		// Unpack driver IDs and per-cell surge counts for this ring.
		for cellStr, cmds := range cellCmds {
			cellSupplyCount[cellStr] = cmds.supplyCmd.Val()
			cellDemandCount[cellStr] = cmds.demandCmd.Val()

			driverIDs, err := cmds.driverIDsCmd.Result()
			if err != nil && err != redis.Nil {
				continue
			}
			for _, driverID := range driverIDs {
				if _, exists := discoveredDriverCells[driverID]; !exists {
					discoveredDriverCells[driverID] = cellStr
				}
			}
		}

		if len(discoveredDriverCells) > 0 {
			break
		}
	}

	if len(discoveredDriverCells) == 0 {
		return nil, nil
	}

	// 2. High-Performance Metadata Hydration Phase via Cluster Pipelines
	// Using transaction pipelines to ensure single roundtrip reads per cluster slot layout
	pipe := s.clusterClient.Pipeline()
	cmdMap := make(map[string]*redis.SliceCmd)

	for driverID := range discoveredDriverCells {
		// Target profile key schema enforcing strict slot uniformity via city hashtags
		profileKey := fmt.Sprintf("driver:{%s:%s}:profile", cityPrefix, driverID)

		// Queue HMGET to extract live metrics from the active caching layer
		cmdMap[driverID] = pipe.HMGet(ctx, profileKey, "osm_node_id", "acceptance_rate", "cancellation_probability", "is_inside_surge_zone", "idle_seconds", "can_drive_manual")
	}

	// Execute pipelined reads concurrently across cluster shards
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("[SPATIAL_SCANNER] profile pipeline exec error: %v", err)
	}

	var candidates []matcher.CandidateDriver

	// 3. Unpack Redis fields and map them to domain CandidateDriver structs
	for driverID, cmd := range cmdMap {
		fields, err := cmd.Result()
		driverCell := discoveredDriverCells[driverID]

		// can_drive_manual (field[5]) defaults to true when absent — most drivers are
		// manual-capable; only an explicit "0"/"false" excludes them from manual cars. Kept
		// lenient so its absence never forces a candidate onto the metric fallback path.
		canDriveManual := true
		if len(fields) == 6 {
			if s, ok := fields[5].(string); ok && (s == "0" || s == "false") {
				canDriveManual = false
			}
		}

		// Guard the five core metric fields individually — a partial HASH write (e.g. crash
		// mid-pipeline) leaves some slots nil, causing a type-assertion panic.
		metricsNil := len(fields) < 5
		if !metricsNil {
			for i := 0; i < 5; i++ {
				if fields[i] == nil {
					metricsNil = true
					break
				}
			}
		}

		if err != nil || metricsNil {
			// Fallback configuration if a driver's ephemeral profile metadata cache expires
			candidates = append(candidates, matcher.CandidateDriver{
				DriverID:                driverID,
				OSMNodeID:               9999, // General city center vertex fallback
				H3Cell:                  driverCell,
				AcceptanceRate:          0.85,
				CancellationProbability: 0.05,
				IsInsideSurgeZone:       false,
				IdleSeconds:             60.0,
				DistanceMeters:          1500,
				LocalDemandCount:        cellDemandCount[driverCell],
				LocalSupplyCount:        cellSupplyCount[driverCell],
				CanDriveManual:          canDriveManual,
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
			H3Cell:                  driverCell,
			AcceptanceRate:          float32(acceptanceRate),
			CancellationProbability: float32(cancellationProb),
			IsInsideSurgeZone:       isInsideSurge,
			IdleSeconds:             idleSecs,
			DistanceMeters:          1000, // Replaced dynamically by Phase 2 graph weights
			LocalDemandCount:        cellDemandCount[driverCell],
			LocalSupplyCount:        cellSupplyCount[driverCell],
			CanDriveManual:          canDriveManual,
		})
	}

	return candidates, nil
}

func (s *SpatialScanner) EvictDriverFromCell(ctx context.Context, cityPrefix, h3Cell, driverID string) error {
	if h3Cell == "" {
		return fmt.Errorf("missing_driver_h3_cell: %s", driverID)
	}
	spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, h3Cell)
	if err := s.clusterClient.ZRem(ctx, spatialZSetKey, driverID).Err(); err != nil {
		return fmt.Errorf("redis spatial eviction failed on key %s: %w", spatialZSetKey, err)
	}
	return nil
}
