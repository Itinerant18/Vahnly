package repository_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
	"github.com/platform/driver-delivery/internal/telemetry/repository"
)

func TestSetDriverLocation_GhostDriverEviction(t *testing.T) {
	ctx := context.Background()

	// 1. Attempt to connect to a local Redis
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{"127.0.0.1:6379"},
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Skipping integration test: local Redis Cluster/server is not available at 127.0.0.1:6379")
	}

	repo := repository.NewRedisRepository(client)

	driverID := "test-driver-999"
	city := "NYC"
	cell1 := "882a100d2dfffff"
	cell2 := "882a100d2d2ffff"

	// Define keys
	statusKey := fmt.Sprintf("driver:{%s}:status:%s", city, driverID)
	trackerKey := fmt.Sprintf("driver:{%s}:current_cell:%s", city, driverID)
	zsetKey1 := fmt.Sprintf("drivers:zset:{%s}:%s", city, cell1)
	zsetKey2 := fmt.Sprintf("drivers:zset:{%s}:%s", city, cell2)

	// Clean up before and after
	cleanup := func() {
		client.Del(ctx, statusKey, trackerKey, zsetKey1, zsetKey2)
	}
	cleanup()
	defer cleanup()

	// 2. Set driver location in cell1
	loc1 := &domain.DriverLocation{
		DriverID:   driverID,
		CityPrefix: city,
		H3Cell:     cell1,
	}

	err := repo.SetDriverLocation(ctx, loc1, 10*time.Second)
	if err != nil {
		t.Fatalf("Failed to set driver location: %v", err)
	}

	// Verify status key is set
	status, err := client.Get(ctx, statusKey).Result()
	if err != nil || status != "ONLINE_AVAILABLE" {
		t.Errorf("Expected status key to be ONLINE_AVAILABLE, got %s (err: %v)", status, err)
	}

	// Verify tracker key is cell1
	trackerCell, err := client.Get(ctx, trackerKey).Result()
	if err != nil || trackerCell != cell1 {
		t.Errorf("Expected tracker cell %s, got %s (err: %v)", cell1, trackerCell, err)
	}

	// Verify driver is in zsetKey1
	score, err := client.ZScore(ctx, zsetKey1, driverID).Result()
	if err != nil {
		t.Errorf("Expected driver in cell1 ZSET, got error: %v", err)
	}
	if score <= 0 {
		t.Errorf("Expected positive timestamp score, got %f", score)
	}

	// 3. Move driver to cell2
	loc2 := &domain.DriverLocation{
		DriverID:   driverID,
		CityPrefix: city,
		H3Cell:     cell2,
	}

	err = repo.SetDriverLocation(ctx, loc2, 10*time.Second)
	if err != nil {
		t.Fatalf("Failed to set driver location in cell2: %v", err)
	}

	// Verify tracker key is updated to cell2
	trackerCell, err = client.Get(ctx, trackerKey).Result()
	if err != nil || trackerCell != cell2 {
		t.Errorf("Expected tracker cell updated to %s, got %s (err: %v)", cell2, trackerCell, err)
	}

	// Verify driver is removed from cell1 ZSET (ZScore should return redis.Nil)
	_, err = client.ZScore(ctx, zsetKey1, driverID).Result()
	if err != redis.Nil {
		t.Errorf("Expected driver to be removed from cell1 ZSET (ghost driver evicted), but got error or found: %v", err)
	}

	// Verify driver is added to cell2 ZSET
	score2, err := client.ZScore(ctx, zsetKey2, driverID).Result()
	if err != nil {
		t.Errorf("Expected driver in cell2 ZSET, got error: %v", err)
	}
	if score2 <= 0 {
		t.Errorf("Expected positive timestamp score in cell2 ZSET, got %f", score2)
	}
}
