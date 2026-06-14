package pruner

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// envSeconds reads an integer-seconds env var, falling back to the default.
func envSeconds(key string, defSec int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return time.Duration(defSec) * time.Second
}

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
		pruneInterval:  envSeconds("PRUNER_INTERVAL_SECONDS", 30), // Sweep cadence (default 30s)
		staleThreshold: envSeconds("PRUNER_STALE_SECONDS", 60),    // Evict sessions older than (default 60s)
	}
}

// StartPrunerLoop blocks and manages the rolling garbage collection schedule
func (p *StaleTelemetryPruner) StartPrunerLoop(ctx context.Context, cityPrefix string, trackedCells []string) {
	// Per-city stale-threshold override, e.g. PRUNER_STALE_SECONDS_BLR=45. Dense
	// cities may need a tighter window than sparse ones.
	if v := os.Getenv("PRUNER_STALE_SECONDS_" + strings.ToUpper(cityPrefix)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			p.staleThreshold = time.Duration(n) * time.Second
		}
	}
	log.Printf("[PRUNER_DAEMON] Initiating Telemetry Garbage Collector for city [%s] (stale=%s, interval=%s). Monitoring %d cells.", cityPrefix, p.staleThreshold, p.pruneInterval, len(trackedCells))
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

// prunerSweepLockKey serializes the GC sweep across replicas via pg_advisory_lock,
// so two pruner pods don't redundantly evict the same cells. Non-blocking: a replica
// that loses the race skips this tick and tries again next interval.
const prunerSweepLockKey int64 = 911002

// ExecuteGarbageCollection clears memory metrics using high-velocity cluster pipelines
func (p *StaleTelemetryPruner) ExecuteGarbageCollection(ctx context.Context, cityPrefix string, cells []string) {
	// Constrain runtime contexts to protect the sub-500ms global SLA limits
	pruneCtx, cancel := context.WithTimeout(ctx, 450*time.Millisecond)
	defer cancel()

	// Single-sweeper guard across replicas.
	lockConn, err := p.dbPool.Acquire(pruneCtx)
	if err != nil {
		return
	}
	defer lockConn.Release()
	var locked bool
	if err := lockConn.QueryRow(pruneCtx, "SELECT pg_try_advisory_lock($1)", prunerSweepLockKey).Scan(&locked); err != nil || !locked {
		return
	}
	defer func() {
		_, _ = lockConn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", prunerSweepLockKey)
	}()

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
