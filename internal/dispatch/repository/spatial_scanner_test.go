package repository_test

import (
	"context"
	"fmt"
	"testing"

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
	
	// Add some driver data to the target cell and a neighbor cell
	spatialRing := h3.KRing(targetCell, 1)
	cell1 := h3.ToString(targetCell)
	cell2 := h3.ToString(spatialRing[1])

	key1 := fmt.Sprintf("drivers:set:%s:%s", city, cell1)
	key2 := fmt.Sprintf("drivers:set:%s:%s", city, cell2)

	// Clean up keys afterwards
	defer func() {
		client.Del(ctx, key1, key2)
	}()

	client.SAdd(ctx, key1, "driver-1", "driver-2")
	client.SAdd(ctx, key2, "driver-3")

	// Scan
	candidates, err := scanner.ScanNearbyDrivers(ctx, city, targetCellStr)
	if err != nil {
		t.Fatalf("Failed to scan nearby drivers: %v", err)
	}

	// Verify we got all 3 drivers
	found := make(map[string]bool)
	for _, c := range candidates {
		found[c.DriverID] = true
	}

	expectedDrivers := []string{"driver-1", "driver-2", "driver-3"}
	for _, d := range expectedDrivers {
		if !found[d] {
			t.Errorf("Expected candidate driver %s was not found in scanner results", d)
		}
	}
}

func TestScanNearbyDrivers_InvalidToken(t *testing.T) {
	scanner := repository.NewSpatialScanner(nil)
	_, err := scanner.ScanNearbyDrivers(context.Background(), "NYC", "invalid-token")
	if err == nil {
		t.Fatal("Expected error for invalid H3 token, got nil")
	}
}
