package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/telemetry/domain"
)

func TestRegion_Contains(t *testing.T) {
	r := &domain.Region{
		RegionID: "kolkata",
		MinLat:   22.4,
		MaxLat:   22.8,
		MinLon:   88.2,
		MaxLon:   88.5,
	}

	// Inside bounds
	if !r.Contains(22.5, 88.3) {
		t.Error("Expected Contains to return true for inside coordinates")
	}

	// Lat too low
	if r.Contains(22.3, 88.3) {
		t.Error("Expected Contains to return false for latitude too low")
	}

	// Lon too high
	if r.Contains(22.5, 88.6) {
		t.Error("Expected Contains to return false for longitude too high")
	}
}

func TestRegionRouter_ResolveRegion(t *testing.T) {
	router := NewRegionRouter(nil, nil, "kolkata")

	// Resolves to kolkata
	r1 := router.resolveRegion(22.5, 88.3)
	if r1 != "kolkata" {
		t.Errorf("Expected region 'kolkata', got '%s'", r1)
	}

	// Resolves to howrah
	r2 := router.resolveRegion(22.6, 88.1)
	if r2 != "howrah" {
		t.Errorf("Expected region 'howrah', got '%s'", r2)
	}

	// Resolves to UNKNOWN
	r3 := router.resolveRegion(10.0, 20.0)
	if r3 != "UNKNOWN" {
		t.Errorf("Expected region 'UNKNOWN', got '%s'", r3)
	}
}

func TestRegionRouter_DetectAndHandoff_SameRegion(t *testing.T) {
	router := NewRegionRouter(nil, nil, "kolkata")

	loc := domain.DriverLocation{
		DriverID:  "driver-1",
		Latitude:  22.5726,
		Longitude: 88.3639,
		Timestamp: time.Now(),
	}

	// Driver is in kolkata (same as currentRegion). DetectAndHandoff should do nothing (no handoff published, no errors).
	err := router.DetectAndHandoff(context.Background(), loc)
	if err != nil {
		t.Errorf("Unexpected error from same region: %v", err)
	}
}
