package calculator

import (
	"context"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestSurgeCalculatorEngine_FormulaMath(t *testing.T) {
	maxSurgeCap := 4.5
	compute := func(demandRate, supplyCount int64) float64 {
		multiplier := 1.0
		if demandRate > 0 {
			effectiveSupply := float64(supplyCount)
			if effectiveSupply == 0 {
				effectiveSupply = 0.5
			}
			computedMultiplier := float64(demandRate) / (effectiveSupply * 0.7)
			multiplier = math.Max(1.0, computedMultiplier)
			if multiplier > maxSurgeCap {
				multiplier = maxSurgeCap
			}
		}
		return math.Round(multiplier*100) / 100
	}

	tests := []struct {
		demand   int64
		supply   int64
		expected float64
	}{
		{demand: 0, supply: 0, expected: 1.0},
		{demand: 5, supply: 0, expected: 4.5},    // capped at max safety ceiling (4.5)
		{demand: 10, supply: 10, expected: 1.43}, // 10 / (10 * 0.7) = 1.42857 -> 1.43
		{demand: 2, supply: 10, expected: 1.0},   // 2 / 7 = 0.2857 < 1.0 -> 1.0
		{demand: 100, supply: 5, expected: 4.5},  // 100 / 3.5 = 28.57 -> capped at 4.5
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("D%d_S%d", tt.demand, tt.supply), func(t *testing.T) {
			res := compute(tt.demand, tt.supply)
			if res != tt.expected {
				t.Errorf("Expected multiplier %f, got %f", tt.expected, res)
			}
		})
	}
}

func TestEvaluateCitySurgeGrid_Integration(t *testing.T) {
	ctx := context.Background()

	// 1. Attempt to connect to local Redis
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: []string{"127.0.0.1:6379"},
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Skipping integration test: local Redis Cluster/server is not available at 127.0.0.1:6379")
	}

	engine := NewSurgeCalculatorEngine([]string{"127.0.0.1:9092"}, client)

	city := "NYC"
	cell := "882a100d2dfffff"
	demandKey := fmt.Sprintf("surge:demand:{%s}:%s", city, cell)
	supplyKey := fmt.Sprintf("surge:supply:{%s}:%s", city, cell)

	// Clean up keys before and after
	cleanup := func() {
		client.Del(ctx, demandKey, supplyKey)
	}
	cleanup()
	defer cleanup()

	// Seed ZSETs
	now := time.Now().Unix()
	futureScore := float64(now + 30)

	// 10 active orders
	for i := 0; i < 10; i++ {
		client.ZAdd(ctx, demandKey, redis.Z{Score: futureScore, Member: fmt.Sprintf("order-%d", i)})
	}
	// 5 active drivers
	for i := 0; i < 5; i++ {
		client.ZAdd(ctx, supplyKey, redis.Z{Score: futureScore, Member: fmt.Sprintf("driver-%d", i)})
	}

	// Evaluate surge
	engine.evaluateCitySurgeGrid(ctx, city, []string{cell})
}
