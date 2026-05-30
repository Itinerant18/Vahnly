package domain

import (
	"time"
)

// Region defines the spatial boundaries for a specific active-active cluster
type Region struct {
	RegionID        string
	Name            string
	MinLat          float64
	MaxLat          float64
	MinLon          float64
	MaxLon          float64
	GeohashPrefixes []string // Optimization for fast prefix matching
}

// RegionHandoffEvent is published to Kafka when a driver crosses a regional boundary
type RegionHandoffEvent struct {
	DriverID        string    `json:"driver_id"`
	OriginRegion    string    `json:"origin_region"`
	TargetRegion    string    `json:"target_region"`
	LastLatitude    float64   `json:"last_latitude"`
	LastLongitude   float64   `json:"last_longitude"`
	VehicleType     string    `json:"vehicle_type"`
	CrossedAt       time.Time `json:"crossed_at"`
	SurgeMultiplier float64   `json:"surge_multiplier,omitempty"` // Preserve surge on crossing
}

// Contains checks if a coordinate falls inside the region's bounding box
func (r *Region) Contains(lat, lon float64) bool {
	return lat >= r.MinLat && lat <= r.MaxLat && lon >= r.MinLon && lon <= r.MaxLon
}
