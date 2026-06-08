package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/platform/driver-delivery/internal/observability"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

type RegionRouter struct {
	regions       map[string]*domain.Region
	redisClient   *redis.ClusterClient
	kafkaWriter   *kafka.Writer
	currentRegion string // The region this specific cluster is responsible for
}

func NewRegionRouter(redis *redis.ClusterClient, kw *kafka.Writer, currentRegion string) *RegionRouter {
	// Seed with active regions (Ideally loaded from a DB or Consul/etcd)
	regions := map[string]*domain.Region{
		"kolkata": {RegionID: "kolkata", MinLat: 22.4, MaxLat: 22.8, MinLon: 88.2, MaxLon: 88.5},
		"howrah":  {RegionID: "howrah", MinLat: 22.5, MaxLat: 22.7, MinLon: 88.0, MaxLon: 88.2},
	}
	
	return &RegionRouter{
		regions:       regions,
		redisClient:   redis,
		kafkaWriter:   kw,
		currentRegion: currentRegion,
	}
}

// DetectAndHandoff checks if the driver left the current region
func (rr *RegionRouter) DetectAndHandoff(ctx context.Context, loc domain.DriverLocation) error {
	// 1. Identify which region the coordinate belongs to
	targetRegion := rr.resolveRegion(loc.Latitude, loc.Longitude)

	// 2. If it matches our current cluster's region, do nothing
	if targetRegion == rr.currentRegion || targetRegion == "UNKNOWN" {
		return nil
	}

	log.Printf("[BOUNDARY CROSSED] Driver %s leaving %s for %s", loc.DriverID, rr.currentRegion, targetRegion)

	// 3. Construct Handoff Event
	event := domain.RegionHandoffEvent{
		DriverID:      loc.DriverID,
		OriginRegion:  rr.currentRegion,
		TargetRegion:  targetRegion,
		LastLatitude:  loc.Latitude,
		LastLongitude: loc.Longitude,
		CrossedAt:     loc.Timestamp,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	// 4. Publish globally replicated handoff event
	err = rr.kafkaWriter.WriteMessages(ctx, kafka.Message{
		Key:   []byte(loc.DriverID), // Key by driver ID to ensure ordered processing
		Value: payload,
	})
	if err != nil {
		return err
	}
	observability.RegionHandoffsTotal.WithLabelValues("published", targetRegion).Inc()

	// 5. Evict from local region's spatial index immediately to prevent ghost dispatching
	rr.redisClient.ZRem(ctx, "driver:locations:"+rr.currentRegion, loc.DriverID)
	
	// Also evict from the H3 index to satisfy nominal dispatcher scans
	if loc.H3Cell != "" {
		spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", loc.CityPrefix, loc.H3Cell)
		rr.redisClient.ZRem(ctx, spatialZSetKey, loc.DriverID)
	}
	
	return nil
}

func (rr *RegionRouter) resolveRegion(lat, lon float64) string {
	for id, region := range rr.regions {
		if region.Contains(lat, lon) {
			return id
		}
	}
	return "UNKNOWN"
}
