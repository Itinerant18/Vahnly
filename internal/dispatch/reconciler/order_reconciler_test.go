package reconciler_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/dispatch/reconciler"
	"github.com/segmentio/kafka-go"
)

func TestOrderReconcilerSyncWorker_ExecuteStateReconciliation(t *testing.T) {
	postgresURL := os.Getenv("DATABASE_URL")
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if postgresURL == "" || kafkaBrokers == "" {
		t.Skip("Skipping integration test: DATABASE_URL and KAFKA_BROKERS environment variables must be set.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
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

	if err := dbPool.Ping(ctx); err != nil {
		t.Skipf("Skipping integration test: PostgreSQL is unreachable: %v", err)
	}

	// 2. Setup mock data
	orderID := "f47ac10b-58cc-4372-a567-0e02b2c3d47a"
	driverID := "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12"
	cityPrefix := "KOL"

	// Cleanup any previous data
	_, _ = dbPool.Exec(ctx, "DELETE FROM orders WHERE id = $1::uuid", orderID)
	_, _ = dbPool.Exec(ctx, "DELETE FROM drivers WHERE id = $1::uuid", driverID)

	// Seed Regional City if not present
	_, _ = dbPool.Exec(ctx, `
		INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active)
		VALUES ($1, 'Kolkata', 'Asia/Kolkata', true)
		ON CONFLICT (city_prefix) DO NOTHING;
	`, cityPrefix)

	// Seed Driver into PostgreSQL as ONLINE_AVAILABLE
	_, err = dbPool.Exec(ctx, `
		INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified)
		VALUES ($1::uuid, $2, 'Reconciler Mock Driver', '+919999990098', 'DL-RECONCILER-TEST', 'ONLINE_AVAILABLE', true);
	`, driverID, cityPrefix)
	if err != nil {
		t.Fatalf("failed to seed Postgres driver: %v", err)
	}
	defer func() {
		_, _ = dbPool.Exec(context.Background(), "DELETE FROM drivers WHERE id = $1::uuid", driverID)
	}()

	// Seed Stuck Order into PostgreSQL (status = 'ASSIGNED', assigned_at = 30 seconds ago)
	assignedAt := time.Now().Add(-30 * time.Second)
	_, err = dbPool.Exec(ctx, `
		INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, assigned_driver_id, assigned_at, base_fare_paise)
		VALUES ($1::uuid, $2, 'c81d4e2e-bcf2-11e6-869b-7df243852131', 'ASSIGNED'::order_status_enum, ST_GeomFromText('POINT(88.3639 22.5726)', 4326)::geography, ST_GeomFromText('POINT(88.3700 22.5800)', 4326)::geography, '88754cb247fffff', $3::uuid, $4, 15000);
	`, orderID, cityPrefix, driverID, assignedAt)
	if err != nil {
		t.Fatalf("failed to seed stuck order: %v", err)
	}
	defer func() {
		_, _ = dbPool.Exec(context.Background(), "DELETE FROM orders WHERE id = $1::uuid", orderID)
	}()

	// 3. Set up Kafka reader to verify emitted event
	brokers := strings.Split(kafkaBrokers, ",")
	assignedReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		Topic:       "order.assigned",
		GroupID:     "reconciler-test-group",
		StartOffset: kafka.LastOffset,
	})
	defer assignedReader.Close()

	// 4. Initialize and Run Stale Telemetry Pruner Execution Sweep
	syncWorker := reconciler.NewOrderReconcilerSyncWorker(dbPool, brokers)
	defer syncWorker.Close()

	// 5. Trigger ExecuteStateReconciliation
	syncWorker.ExecuteStateReconciliation(ctx, cityPrefix)

	// 6. Verify Kafka assigned message is emitted
	readCtx, readCancel := context.WithTimeout(ctx, 5*time.Second)
	defer readCancel()

	msg, err := assignedReader.ReadMessage(readCtx)
	if err != nil {
		t.Fatalf("Failed to consume order.assigned message: %v", err)
	}

	var assignedPayload map[string]interface{}
	if err := json.Unmarshal(msg.Value, &assignedPayload); err != nil {
		t.Fatalf("Failed to parse order.assigned payload: %v", err)
	}

	if assignedPayload["order_id"] != orderID {
		t.Errorf("Expected order_id %q, got %q", orderID, assignedPayload["order_id"])
	}
	if assignedPayload["driver_id"] != driverID {
		t.Errorf("Expected driver_id %q, got %q", driverID, assignedPayload["driver_id"])
	}
	if reconciled, ok := assignedPayload["reconciled"].(bool); !ok || !reconciled {
		t.Errorf("Expected reconciled=true, got %v", assignedPayload["reconciled"])
	}
}
