package aggregator_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/platform/driver-delivery/internal/surge/aggregator"
)

func TestGetRecentDemandRate_Integration(t *testing.T) {
	ctx := context.Background()

	// 1. Attempt to connect to a local Redis
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{"127.0.0.1:6379"},
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Skipping integration test: local Redis Cluster/server is not available at 127.0.0.1:6379")
	}

	stream := aggregator.NewDemandAggregatorStream([]string{"127.0.0.1:9092"}, client)

	city := "NYC"
	cell := "882a100d2dfffff"
	redisKey := fmt.Sprintf("surge:demand:{%s}:%s", city, cell)

	// Clean up key before and after
	cleanup := func() {
		client.Del(ctx, redisKey)
	}
	cleanup()
	defer cleanup()

	// Seed ZSET with some non-expired and expired orders
	now := time.Now().Unix()
	futureScore := float64(now + 30)
	pastScore := float64(now - 10)

	// order-1 is active (expiration in future)
	client.ZAdd(ctx, redisKey, redis.Z{Score: futureScore, Member: "order-1"})
	// order-2 is stale/expired (expiration in past)
	client.ZAdd(ctx, redisKey, redis.Z{Score: pastScore, Member: "order-2"})

	// Call GetRecentDemandRate
	count, err := stream.GetRecentDemandRate(ctx, city, cell)
	if err != nil {
		t.Fatalf("Failed to get recent demand rate: %v", err)
	}

	// order-2 should be evicted because it's expired, and only order-1 remains
	if count != 1 {
		t.Errorf("Expected count to be 1, got %d", count)
	}

	// Verify order-2 is indeed deleted from the ZSET
	exists, err := client.ZScore(ctx, redisKey, "order-2").Result()
	if err != redis.Nil {
		t.Errorf("Expected order-2 to be cleaned up from ZSET, but ZScore got score %f (err: %v)", exists, err)
	}
}
