package positioning

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// RebalancePrompt defines the agentic nudge sent to a driver
type RebalancePrompt struct {
	DriverID    string  `json:"driver_id"`
	TargetCell  string  `json:"target_h3_cell"`
	Message     string  `json:"message"`
	BonusVector float64 `json:"bonus_vector"`
}

// Predictive positioning tuning. The evaluation loop samples instantaneous
// demand each tick into a capped Redis history list, then linearly extrapolates
// demandProjectionHorizon ticks forward so the fleet is steered toward where
// demand WILL be — not where it currently is.
const (
	demandSampleWindow       = 12 // recent demand samples retained per cell
	demandProjectionHorizon  = 3  // ticks to project forward (~ next few cycles)
	defaultNudgeFanout       = 6  // drivers nudged per incentive when unspecified
	defaultNudgeBonusVector  = 1.2
	defaultNudgeMessage      = "High demand nearby! Reposition for priority dispatch matching."
)

type FleetRebalancer struct {
	redisClient *redis.ClusterClient
	cityPrefix  string
}

func NewFleetRebalancer(rdb *redis.ClusterClient, city string) *FleetRebalancer {
	return &FleetRebalancer{
		redisClient: rdb,
		cityPrefix:  city,
	}
}

// StartEvaluationLoop runs the predictive positioning sweep every 60 seconds
func (r *FleetRebalancer) StartEvaluationLoop(ctx context.Context) {
	log.Printf("[REBALANCER] Starting Agentic Fleet Rebalancing Daemon for region: %s", r.cityPrefix)
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[REBALANCER] Shutting down evaluation loop.")
			return
		case <-ticker.C:
			r.evaluateGridDeficits(ctx)
		}
	}
}

func (r *FleetRebalancer) evaluateGridDeficits(ctx context.Context) {
	// 1. Scan active supply and demand cells
	// In a full production ML setup, this would query Triton for time-series projections.
	// Here we evaluate a heuristic ratio based on current live metrics.
	
	// Example targeted evaluation for a known high-density commercial zone
	commercialZoneH3 := "88283082b9fffff" 
	
	supplyKey := fmt.Sprintf("surge:supply:%s:%s", r.cityPrefix, commercialZoneH3)
	demandKey := fmt.Sprintf("surge:demand:%s:%s", r.cityPrefix, commercialZoneH3)

	pipe := r.redisClient.Pipeline()
	supplyCmd := pipe.ZCard(ctx, supplyKey)
	demandCmd := pipe.ZCard(ctx, demandKey)
	_, err := pipe.Exec(ctx)

	if err != nil {
		log.Printf("[REBALANCER] Failed to read spatial keys: %v", err)
		return
	}

	supply := supplyCmd.Val()
	demand := demandCmd.Val()

	// 2. Record this demand sample and project where demand is heading. Predictive
	//    positioning acts on the FORECAST, so the fleet arrives ahead of the spike.
	projected := r.projectCellDemand(ctx, commercialZoneH3, float64(demand))

	// 3. Identify a future deficit: projected demand outruns current supply.
	if projected > float64(supply)*2 {
		log.Printf("[REBALANCER] Projected deficit in cell %s. Demand now: %d, projected: %.1f, Supply: %d",
			commercialZoneH3, demand, projected, supply)
		r.broadcastRepositioningPrompts(ctx, commercialZoneH3)
	}
}

// projectCellDemand pushes the latest demand reading into a capped per-cell
// history list and returns the demand projected demandProjectionHorizon ticks
// ahead. Redis errors degrade gracefully to the instantaneous reading.
func (r *FleetRebalancer) projectCellDemand(ctx context.Context, cell string, current float64) float64 {
	histKey := fmt.Sprintf("surge:demand:hist:%s:%s", r.cityPrefix, cell)

	pipe := r.redisClient.Pipeline()
	pipe.LPush(ctx, histKey, current)
	pipe.LTrim(ctx, histKey, 0, demandSampleWindow-1)
	pipe.Expire(ctx, histKey, time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("[REBALANCER] demand history write failed for %s: %v", cell, err)
		return current
	}

	// LRange returns newest-first; reverse into oldest->newest for projection.
	raw, err := r.redisClient.LRange(ctx, histKey, 0, -1).Result()
	if err != nil {
		return current
	}
	samples := make([]float64, 0, len(raw))
	for i := len(raw) - 1; i >= 0; i-- {
		var v float64
		if _, err := fmt.Sscanf(raw[i], "%g", &v); err == nil {
			samples = append(samples, v)
		}
	}
	return ProjectDemand(samples, demandProjectionHorizon)
}

// ProjectDemand linearly extrapolates a demand time series `horizon` steps into
// the future using the average slope across the window. samples are ordered
// oldest->newest. Fewer than two samples returns the latest value (or 0). The
// result is floored at 0 — projected demand cannot go negative.
func ProjectDemand(samples []float64, horizon int) float64 {
	n := len(samples)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return samples[0]
	}
	slope := (samples[n-1] - samples[0]) / float64(n-1)
	projected := samples[n-1] + slope*float64(horizon)
	if projected < 0 {
		return 0
	}
	return projected
}

func (r *FleetRebalancer) broadcastRepositioningPrompts(ctx context.Context, targetCell string) {
	// Find idle drivers in a neighboring low-demand cell (mocked nearby cell)
	idleCellH3 := "88283082b9fcdef"
	n, err := r.NudgeDrivers(ctx, targetCell, idleCellH3,
		"High demand nearby! Move 3 minutes north for priority dispatch matching.",
		defaultNudgeBonusVector, defaultNudgeFanout)
	if err != nil {
		log.Printf("[REBALANCER] repositioning broadcast failed for cell %s: %v", targetCell, err)
		return
	}
	if n > 0 {
		log.Printf("[REBALANCER] Agentic prompts dispatched to %d drivers toward cell %s", n, targetCell)
	}
}

// NudgeDrivers broadcasts a positioning incentive to up to `max` drivers found
// in sourceCell, steering them toward targetCell. Returns the count nudged. This
// is the shared path used by both the autonomous evaluation loop and the
// POST /api/internal/surge/nudge incentive API (inference engine / simulator).
func (r *FleetRebalancer) NudgeDrivers(ctx context.Context, targetCell, sourceCell, message string, bonus float64, max int64) (int, error) {
	if max <= 0 {
		max = defaultNudgeFanout
	}
	if message == "" {
		message = defaultNudgeMessage
	}
	if bonus <= 0 {
		bonus = defaultNudgeBonusVector
	}

	driverSetKey := fmt.Sprintf("drivers:zset:%s:%s", r.cityPrefix, sourceCell)
	drivers, err := r.redisClient.ZRangeArgs(ctx, redis.ZRangeArgs{
		Key:   driverSetKey,
		Start: 0,
		Stop:  max - 1,
		Rev:   true,
	}).Result()
	if err != nil {
		return 0, err
	}

	for _, driverID := range drivers {
		prompt := RebalancePrompt{
			DriverID:    driverID,
			TargetCell:  targetCell,
			Message:     message,
			BonusVector: bonus,
		}
		payload, _ := json.Marshal(prompt)
		channel := fmt.Sprintf("gateway:driver:notifications:%s", driverID)
		r.redisClient.Publish(ctx, channel, payload)
	}
	return len(drivers), nil
}
