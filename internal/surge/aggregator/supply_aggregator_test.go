package aggregator_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/surge/aggregator"
	"github.com/redis/go-redis/v9"
)

// We bypass the private struct restriction by using a test helper or exposing a test-oriented interface.
// Since mutateRollingSupplyWindow is unexported, we can verify the integration via a reflection or test-only wrapper,
// or we can test GetAvailableDriverCount directly against key states.
// Wait, we can test GetAvailableDriverCount. Since it is exported:
// func (s *SupplyAggregatorStream) GetAvailableDriverCount(ctx context.Context, cityPrefix, h3Cell string) (int64, error)
// And we can write to the Redis key manually to verify count logic and stale cleanup!

func TestGetAvailableDriverCount_Integration(t *testing.T) {
	ctx := context.Background()

	// 1. Attempt to connect to a local Redis
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{"127.0.0.1:6379"},
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Skipping integration test: local Redis Cluster/server is not available at 127.0.0.1:6379")
	}

	stream := aggregator.NewSupplyAggregatorStream([]string{"127.0.0.1:9092"}, client)

	city := "NYC"
	cell := "882a100d2dfffff"
	redisKey := fmt.Sprintf("surge:supply:{%s}:%s", city, cell)

	// Clean up key before and after
	cleanup := func() {
		client.Del(ctx, redisKey)
	}
	cleanup()
	defer cleanup()

	// Seed ZSET with some non-expired and expired drivers
	now := time.Now().Unix()
	futureScore := float64(now + 30)
	pastScore := float64(now - 10)

	// driver-1 is active (expiration in future)
	client.ZAdd(ctx, redisKey, redis.Z{Score: futureScore, Member: "driver-1"})
	// driver-2 is stale/expired (expiration in past)
	client.ZAdd(ctx, redisKey, redis.Z{Score: pastScore, Member: "driver-2"})

	// Call GetAvailableDriverCount
	count, err := stream.GetAvailableDriverCount(ctx, city, cell)
	if err != nil {
		t.Fatalf("Failed to get available driver count: %v", err)
	}

	// driver-2 should be evicted because it's expired, and only driver-1 remains
	if count != 1 {
		t.Errorf("Expected count to be 1, got %d", count)
	}

	// Verify driver-2 is indeed deleted from the ZSET
	exists, err := client.ZScore(ctx, redisKey, "driver-2").Result()
	if err != redis.Nil {
		t.Errorf("Expected driver-2 to be cleaned up from ZSET, but ZScore got score %f (err: %v)", exists, err)
	}
}
