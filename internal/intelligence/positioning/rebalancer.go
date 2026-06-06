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

	// 2. Identify Future Deficit (e.g., Demand is spiking faster than Supply is arriving)
	if demand > supply*2 {
		log.Printf("[REBALANCER] Severe deficit detected in cell %s. Demand: %d, Supply: %d", commercialZoneH3, demand, supply)
		r.broadcastRepositioningPrompts(ctx, commercialZoneH3)
	}
}

func (r *FleetRebalancer) broadcastRepositioningPrompts(ctx context.Context, targetCell string) {
	// Find idle drivers in a neighboring low-demand cell (mocked nearby cell)
	idleCellH3 := "88283082b9fcdef"
	driverSetKey := fmt.Sprintf("drivers:zset:%s:%s", r.cityPrefix, idleCellH3)
	
	drivers, err := r.redisClient.ZRangeArgs(ctx, redis.ZRangeArgs{
		Key:   driverSetKey,
		Start: 0,
		Stop:  5,
		Rev:   true,
	}).Result()
	if err != nil || len(drivers) == 0 {
		return
	}

	// 3. Dispatch Agentic Broadcasts via Redis Pub/Sub
	for _, driverID := range drivers {
		prompt := RebalancePrompt{
			DriverID:    driverID,
			TargetCell:  targetCell,
			Message:     "High demand nearby! Move 3 minutes north for priority dispatch matching.",
			BonusVector: 1.2,
		}
		
		payload, _ := json.Marshal(prompt)
		channel := fmt.Sprintf("gateway:driver:notifications:%s", driverID)
		
		r.redisClient.Publish(ctx, channel, payload)
		log.Printf("[REBALANCER] Agentic prompt dispatched to driver %s", driverID)
	}
}
