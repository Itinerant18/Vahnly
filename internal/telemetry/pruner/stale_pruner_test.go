package pruner_test

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/telemetry/pruner"
	"github.com/redis/go-redis/v9"
)

func TestStaleTelemetryPruner_ExecuteGarbageCollection(t *testing.T) {
	postgresURL := os.Getenv("DATABASE_URL")
	redisNodes := os.Getenv("REDIS_CLUSTER_NODES")
	if postgresURL == "" || redisNodes == "" {
		t.Skip("Skipping integration test: DATABASE_URL and REDIS_CLUSTER_NODES environment variables must be set.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Setup PostgreSQL pool
	dbConfig, err := pgxpool.ParseConfig(postgresURL)
	if err != nil {
		t.Fatalf("failed to parse postgres config: %v", err)
	}
	dbPool, err := pgxpool.NewWithConfig(ctx, dbConfig)
	if err != nil {
		t.Fatalf("failed to connect to postgres: %v", err)
	}
	defer dbPool.Close()

	// 2. Setup Redis Cluster Client with Port Forwarding Support
	nodeList := strings.Split(redisNodes, ",")
	ipMapStr := os.Getenv("REDIS_IP_MAP")
	ipMap := make(map[string]string)
	if ipMapStr != "" {
		for _, pair := range strings.Split(ipMapStr, ",") {
			parts := strings.Split(pair, "=")
			if len(parts) == 2 {
				ipMap[parts[0]] = parts[1]
			}
		}
	}

	redisClusterClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: nodeList,
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if localAddr, ok := ipMap[addr]; ok {
				addr = localAddr
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, addr)
		},
	})
	defer redisClusterClient.Close()

	if err := redisClusterClient.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis Cluster is unreachable: %v", err)
	}

	// 3. Setup Mock Data
	driverID := "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99"
	cityPrefix := "KOL"
	h3Cell := "88754cb247fffff"
	zsetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, h3Cell)

	// Clean up any stale records from previous aborted tests
	_, _ = dbPool.Exec(ctx, "DELETE FROM drivers WHERE id = $1::uuid", driverID)
	_ = redisClusterClient.ZRem(ctx, zsetKey, driverID).Err()

	// Seed Regional City if not present
	_, _ = dbPool.Exec(ctx, `
		INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active)
		VALUES ($1, 'Kolkata', 'Asia/Kolkata', true)
		ON CONFLICT (city_prefix) DO NOTHING;
	`, cityPrefix)

	// Seed Driver into PostgreSQL as ONLINE_AVAILABLE
	_, err = dbPool.Exec(ctx, `
		INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified)
		VALUES ($1::uuid, $2, 'Pruner Mock Driver', '+919999990099', 'DL-PRUNER-TEST', 'ONLINE_AVAILABLE', true);
	`, driverID, cityPrefix)
	if err != nil {
		t.Fatalf("failed to seed Postgres driver: %v", err)
	}
	defer func() {
		_, _ = dbPool.Exec(context.Background(), "DELETE FROM drivers WHERE id = $1::uuid", driverID)
	}()

	// Seed Stale Driver into Redis ZSET (stale score = 2 minutes ago)
	staleScore := float64(time.Now().Add(-2 * time.Minute).Unix())
	err = redisClusterClient.ZAdd(ctx, zsetKey, redis.Z{
		Score:  staleScore,
		Member: driverID,
	}).Err()
	if err != nil {
		t.Fatalf("failed to seed stale Redis driver: %v", err)
	}
	defer func() {
		_ = redisClusterClient.ZRem(context.Background(), zsetKey, driverID)
	}()

	// 4. Initialize and Run Stale Telemetry Pruner Execution Sweep
	prunerDaemon := pruner.NewStaleTelemetryPruner(redisClusterClient, dbPool)
	prunerDaemon.ExecuteGarbageCollection(ctx, cityPrefix, []string{h3Cell})

	// Wait briefly for the async Postgres transaction block to finalize
	time.Sleep(150 * time.Millisecond)

	// 5. Assertions
	// Check Redis: driver must be evicted from the ZSET
	score, err := redisClusterClient.ZScore(ctx, zsetKey, driverID).Result()
	if err != redis.Nil {
		t.Errorf("Expected driver to be evicted from Redis ZSET, but found score: %v (err: %v)", score, err)
	}

	// Check Postgres: driver current_state must be updated to OFFLINE
	var finalState string
	err = dbPool.QueryRow(ctx, "SELECT current_state FROM drivers WHERE id = $1::uuid", driverID).Scan(&finalState)
	if err != nil {
		t.Fatalf("failed to query Postgres driver status: %v", err)
	}

	expectedState := "OFFLINE"
	if finalState != expectedState {
		t.Errorf("Expected driver status to be transitioned to %s, got %s", expectedState, finalState)
	}
}
