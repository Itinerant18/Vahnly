package repository_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/uber/h3-go/v3"

	"github.com/platform/driver-delivery/internal/dispatch/repository"
)

func TestScanNearbyDrivers_LocalIntegration(t *testing.T) {
	ctx := context.Background()

	// 1. Attempt to connect to a local Redis (assuming it might run on 6379, single-node fallback is supported by clusterClient)
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{"127.0.0.1:6379"},
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Skipping integration test: local Redis Cluster/server is not available at 127.0.0.1:6379")
	}

	scanner := repository.NewSpatialScanner(client)

	city := "NYC"
	targetCellStr := "882a100d2dfffff"
	targetCell := h3.FromString(targetCellStr)

	// Add some driver data to the target cell and a neighbor cell using ZSet structure
	spatialRing := h3.KRing(targetCell, 1)
	cell1 := h3.ToString(targetCell)
	cell2 := h3.ToString(spatialRing[1])

	// Key names must follow decoupled layout: drivers:zset:cityPrefix:h3cell
	key1 := fmt.Sprintf("drivers:zset:%s:%s", city, cell1)
	key2 := fmt.Sprintf("drivers:zset:%s:%s", city, cell2)

	// Clean up keys afterwards
	defer func() {
		client.Del(ctx, key1, key2)
	}()

	now := float64(time.Now().Unix())
	client.ZAdd(ctx, key1, redis.Z{Score: now, Member: "driver-1"}, redis.Z{Score: now, Member: "driver-2"})
	client.ZAdd(ctx, key2, redis.Z{Score: now, Member: "driver-3"})

	// Scan
	candidates, err := scanner.ScanNearbyDrivers(ctx, city, targetCellStr)
	if err != nil {
		t.Fatalf("Failed to scan nearby drivers: %v", err)
	}

	// Verify we got all 3 drivers
	found := make(map[string]bool)
	cells := make(map[string]string)
	for _, c := range candidates {
		found[c.DriverID] = true
		cells[c.DriverID] = c.H3Cell
	}

	expectedDrivers := []string{"driver-1", "driver-2", "driver-3"}
	for _, d := range expectedDrivers {
		if !found[d] {
			t.Errorf("Expected candidate driver %s was not found in scanner results", d)
		}
	}
	if cells["driver-1"] != cell1 || cells["driver-3"] != cell2 {
		t.Errorf("Expected candidate H3 cells to be preserved, got driver-1=%s driver-3=%s", cells["driver-1"], cells["driver-3"])
	}
}

func TestScanNearbyDrivers_InvalidToken(t *testing.T) {
	scanner := repository.NewSpatialScanner(nil)
	_, err := scanner.ScanNearbyDrivers(context.Background(), "NYC", "invalid-token")
	if err == nil {
		t.Fatal("Expected error for invalid H3 token, got nil")
	}
}

// SweepStaleZSetBelow is the per-node removal primitive SweepStaleCells fans across the
// cluster. Tested in-process against miniredis (no daemon, no cluster needed).
func TestSweepStaleZSetBelow_RemovesStaleKeepsFresh(t *testing.T) {
	ctx := context.Background()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis start: %v", err)
	}
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	// cutoff = 1000 → members scored < 1000 are stale. cellA has one fresh + one stale;
	// cellB has only a stale member (and must be emptied).
	key1 := "drivers:zset:SWEEPTEST:cellA"
	key2 := "drivers:zset:SWEEPTEST:cellB"
	client.ZAdd(ctx, key1, redis.Z{Score: 2000, Member: "fresh-driver"})
	client.ZAdd(ctx, key1, redis.Z{Score: 500, Member: "stale-driver"})
	client.ZAdd(ctx, key2, redis.Z{Score: 500, Member: "stale-only"})

	removed, err := repository.SweepStaleZSetBelow(ctx, client, 1000)
	if err != nil {
		t.Fatalf("SweepStaleZSetBelow: %v", err)
	}
	if removed != 2 {
		t.Fatalf("expected 2 stale members removed, got %d", removed)
	}

	got1, _ := client.ZRange(ctx, key1, 0, -1).Result()
	if len(got1) != 1 || got1[0] != "fresh-driver" {
		t.Errorf("cellA should keep only fresh-driver, got %v", got1)
	}
	if card2, _ := client.ZCard(ctx, key2).Result(); card2 != 0 {
		t.Errorf("cellB (all stale) should be emptied, got card=%d", card2)
	}
}

// The cutoff is exclusive: a driver scored exactly at it stays visible, mirroring the
// scanner's read window so a borderline driver isn't churned out of the index.
func TestSweepStaleZSetBelow_ExclusiveCutoff(t *testing.T) {
	ctx := context.Background()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis start: %v", err)
	}
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	key := "drivers:zset:BOUND:cellA"
	client.ZAdd(ctx, key, redis.Z{Score: 999, Member: "below"})
	client.ZAdd(ctx, key, redis.Z{Score: 1000, Member: "at-cutoff"})
	client.ZAdd(ctx, key, redis.Z{Score: 1001, Member: "above"})

	removed, err := repository.SweepStaleZSetBelow(ctx, client, 1000)
	if err != nil {
		t.Fatalf("SweepStaleZSetBelow: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected only the score<1000 member removed, got %d", removed)
	}

	got, _ := client.ZRange(ctx, key, 0, -1).Result()
	if len(got) != 2 || got[0] != "at-cutoff" || got[1] != "above" {
		t.Errorf("expected [at-cutoff above] kept (cutoff-inclusive), got %v", got)
	}
}
