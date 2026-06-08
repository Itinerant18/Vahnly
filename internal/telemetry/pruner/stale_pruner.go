package pruner

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type StaleTelemetryPruner struct {
	clusterClient  *redis.ClusterClient
	dbPool         *pgxpool.Pool
	pruneInterval  time.Duration
	staleThreshold time.Duration
}

func NewStaleTelemetryPruner(client *redis.ClusterClient, db *pgxpool.Pool) *StaleTelemetryPruner {
	return &StaleTelemetryPruner{
		clusterClient:  client,
		dbPool:         db,
		pruneInterval:  30 * time.Second, // Sweeps spatial indexes every 30 seconds
		staleThreshold: 60 * time.Second, // Evicts sessions older than 60 seconds
	}
}

// StartPrunerLoop blocks and manages the rolling garbage collection schedule
func (p *StaleTelemetryPruner) StartPrunerLoop(ctx context.Context, cityPrefix string, trackedCells []string) {
	log.Printf("[PRUNER_DAEMON] Initiating Telemetry Garbage Collector for city [%s]. Monitoring %d cells.", cityPrefix, len(trackedCells))
	ticker := time.NewTicker(p.pruneInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[PRUNER_DAEMON] Stopping Telemetry Garbage Collector worker for city %s.", cityPrefix)
			return
		case <-ticker.C:
			p.ExecuteGarbageCollection(ctx, cityPrefix, trackedCells)
		}
	}
}

// ExecuteGarbageCollection clears memory metrics using high-velocity cluster pipelines
func (p *StaleTelemetryPruner) ExecuteGarbageCollection(ctx context.Context, cityPrefix string, cells []string) {
	// Constrain runtime contexts to protect the sub-500ms global SLA limits
	pruneCtx, cancel := context.WithTimeout(ctx, 450*time.Millisecond)
	defer cancel()

	now := time.Now().Unix()
	maxStaleEpoch := now - int64(p.staleThreshold.Seconds())

	pipe := p.clusterClient.Pipeline()

	// 1. Queue atomic sweeps across all tracked H3 spatial cell indices
	for _, cell := range cells {
		// Key syntax matches the scattered spatial tracking ZSET contract
		zsetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, cell)

		// First, capture the stale driver IDs before evicting them to sync PostgreSQL
		pipe.ZRangeByScore(pruneCtx, zsetKey, &redis.ZRangeBy{
			Min: "-inf",
			Max: fmt.Sprintf("%d", maxStaleEpoch),
		})

		// Evict stale driver members from the spatial ZSET index
		pipe.ZRemRangeByScore(pruneCtx, zsetKey, "-inf", fmt.Sprintf("%d", maxStaleEpoch))
	}

	cmds, err := pipe.Exec(pruneCtx)
	if err != nil && err != redis.Nil {
		log.Printf("[PRUNER_ERROR] Redis cluster index sweep pipeline failed: %v", err)
		return
	}

	var expiredDriverIDs []string

	// Unpack the results to gather all evicted driver IDs
	for i := 0; i < len(cmds); i += 2 {
		rangeCmd, ok := cmds[i].(*redis.StringSliceCmd)
		if ok {
			drivers, err := rangeCmd.Result()
			if err == nil && len(drivers) > 0 {
				expiredDriverIDs = append(expiredDriverIDs, drivers...)
			}
		}
	}

	if len(expiredDriverIDs) == 0 {
		return
	}

	// 2. Synchronize memory state with PostgreSQL storage registers in a single block
	// Moves offline sessions out of ONLINE_AVAILABLE status flags
	go func(driversToUpdate []string) {
		dbCtx, dbCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer dbCancel()

		query := `
			UPDATE drivers 
			SET current_state = 'OFFLINE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP
			WHERE id = ANY($1::uuid[]) AND current_state = 'ONLINE_AVAILABLE'::driver_state_enum;
		`

		res, err := p.dbPool.Exec(dbCtx, query, driversToUpdate)
		if err != nil {
			log.Printf("[PRUNER_DB_ERROR] Failed updating stale driver rows: %v", err)
			return
		}
		log.Printf("[PRUNER_DAEMON] Successfully processed garbage collection sweep. Evicted %d disconnected drivers to OFFLINE state. Rows Affected: %d", len(driversToUpdate), res.RowsAffected())
	}(expiredDriverIDs)
}
