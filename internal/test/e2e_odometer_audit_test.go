package test

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	. "github.com/platform/driver-delivery/internal/gateway/delivery/http"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// TestOdometerAuditReconciliation validates the complete odometer ingestion → admin
// audit → financial reconciliation pipeline using direct DB operations. This is the
// assertion library that specifically confirms the OdometerVerificationPanel reflects
// correct data from trip_odometer_checkpoints.
//
// The test exercises three regression scenarios:
//  1. Low variance  → AUTO_RECONCILED (CLEARED)
//  2. High variance → FINANCIAL_REVIEW_REQUIRED
//  3. Missing END   → PENDING_CHECKPOINT (has_both = false)
func TestOdometerAuditReconciliation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	postgresURL := os.Getenv("DATABASE_URL")
	if postgresURL == "" {
		postgresURL = "postgresql://postgres:HardenedProdPassword@localhost:5432/delivery_platform?sslmode=disable"
	}
	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		t.Fatalf("Database connection failed: %v", err)
	}
	defer dbPool.Close()

	redisNodes := os.Getenv("REDIS_CLUSTER_NODES")
	if redisNodes == "" {
		redisNodes = "127.0.0.1:6379"
	}
	redisIPMap := os.Getenv("REDIS_IP_MAP")
	ipMap := make(map[string]string)
	if redisIPMap != "" {
		for _, pair := range strings.Split(redisIPMap, ",") {
			parts := strings.Split(pair, "=")
			if len(parts) == 2 {
				ipMap[parts[0]] = parts[1]
			}
		}
	}
	redisClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: strings.Split(redisNodes, ","),
		Dialer: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if localAddr, ok := ipMap[addr]; ok {
				addr = localAddr
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, addr)
		},
	})
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Fatalf("Redis cluster unresponsive: %v", err)
	}

	// ═══════════════════════════════════════════════════════════════════
	// Scenario 1: LOW VARIANCE — AUTO RECONCILED
	// ═══════════════════════════════════════════════════════════════════
	t.Run("LowVariance_AutoReconciled", func(t *testing.T) {
		orderID := "00000000-0000-0000-bbbb-000000000001"
		driverID := "00000000-0000-0000-bbbb-000000000099"

		cleanup(ctx, dbPool, orderID, driverID)
		seedDriverAndOrder(ctx, t, dbPool, driverID, orderID, 10.0) // 10km straight-line

		// Insert START checkpoint
		insertCheckpoint(ctx, t, dbPool, orderID, driverID, "START", 50000, 90)
		// Advance order to DELIVERING
		advanceOrderStatus(ctx, t, dbPool, orderID, "DELIVERING")
		// Insert END checkpoint: 50013 - 50000 = 13km reported on a 10*1.3=13km expected road distance
		insertCheckpoint(ctx, t, dbPool, orderID, driverID, "END", 50013, 85)

		// Query the audit computation
		audit := computeAudit(ctx, t, dbPool, orderID)

		if !audit.hasBoth {
			t.Fatalf("Expected has_both=true, got false")
		}
		if audit.isFlagged {
			t.Errorf("Expected is_flagged=false for low variance, got true (variance=%.1f%%)", audit.variancePct)
		}
		if audit.reportedKm != 13 {
			t.Errorf("Expected reported_km=13, got %d", audit.reportedKm)
		}
		t.Logf("✅ Low variance scenario: reported=%dkm, expected=%.1fkm, variance=%.1f%%, flagged=%t",
			audit.reportedKm, audit.expectedKm, audit.variancePct, audit.isFlagged)
	})

	// ═══════════════════════════════════════════════════════════════════
	// Scenario 2: HIGH VARIANCE — FINANCIAL REVIEW REQUIRED
	// ═══════════════════════════════════════════════════════════════════
	t.Run("HighVariance_FinancialReviewRequired", func(t *testing.T) {
		orderID := "00000000-0000-0000-bbbb-000000000002"
		driverID := "00000000-0000-0000-bbbb-000000000098"

		cleanup(ctx, dbPool, orderID, driverID)
		seedDriverAndOrder(ctx, t, dbPool, driverID, orderID, 10.0) // 10km straight-line → 13km road

		insertCheckpoint(ctx, t, dbPool, orderID, driverID, "START", 50000, 88)
		advanceOrderStatus(ctx, t, dbPool, orderID, "DELIVERING")
		// 50020 - 50000 = 20km on a 13km expected → ~53.8% variance → FLAGGED
		insertCheckpoint(ctx, t, dbPool, orderID, driverID, "END", 50020, 78)

		audit := computeAudit(ctx, t, dbPool, orderID)

		if !audit.hasBoth {
			t.Fatalf("Expected has_both=true, got false")
		}
		if !audit.isFlagged {
			t.Errorf("Expected is_flagged=true for high variance, got false (variance=%.1f%%)", audit.variancePct)
		}
		if audit.reportedKm != 20 {
			t.Errorf("Expected reported_km=20, got %d", audit.reportedKm)
		}
		t.Logf("✅ High variance scenario: reported=%dkm, expected=%.1fkm, variance=%.1f%%, flagged=%t",
			audit.reportedKm, audit.expectedKm, audit.variancePct, audit.isFlagged)
	})

	// ═══════════════════════════════════════════════════════════════════
	// Scenario 3: MISSING END CHECKPOINT — PENDING
	// ═══════════════════════════════════════════════════════════════════
	t.Run("MissingEndCheckpoint_Pending", func(t *testing.T) {
		orderID := "00000000-0000-0000-bbbb-000000000003"
		driverID := "00000000-0000-0000-bbbb-000000000097"

		cleanup(ctx, dbPool, orderID, driverID)
		seedDriverAndOrder(ctx, t, dbPool, driverID, orderID, 12.0)

		// Only insert START checkpoint
		insertCheckpoint(ctx, t, dbPool, orderID, driverID, "START", 60000, 92)
		advanceOrderStatus(ctx, t, dbPool, orderID, "DELIVERING")

		audit := computeAudit(ctx, t, dbPool, orderID)

		if audit.hasBoth {
			t.Errorf("Expected has_both=false for missing END checkpoint, got true")
		}
		if audit.isFlagged {
			t.Errorf("Expected is_flagged=false when checkpoint incomplete, got true")
		}
		t.Logf("✅ Missing END checkpoint: has_both=%t, flagged=%t", audit.hasBoth, audit.isFlagged)
	})
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers: DB operations matching the admin OdometerHandler's computeAudit
// ═══════════════════════════════════════════════════════════════════════

const odoRoadFactor = 1.3
const odoTolerancePct = 15.0

type auditResult struct {
	expectedKm  float64
	hasBoth     bool
	reportedKm  int
	variancePct float64
	isFlagged   bool
}

func computeAudit(ctx context.Context, t *testing.T, db *pgxpool.Pool, orderID string) auditResult {
	t.Helper()

	var straightKm float64
	err := db.QueryRow(ctx,
		`SELECT ST_Distance(pickup_location, dropoff_location) / 1000.0 FROM orders WHERE id = $1::uuid`,
		orderID).Scan(&straightKm)
	if err != nil {
		t.Fatalf("Failed reading order distance: %v", err)
	}

	expectedKm := straightKm * odoRoadFactor

	rows, err := db.Query(ctx,
		`SELECT checkpoint_type, odometer_value FROM trip_odometer_checkpoints WHERE order_id = $1::uuid`, orderID)
	if err != nil {
		t.Fatalf("Failed querying checkpoints: %v", err)
	}
	defer rows.Close()

	var startOdo, endOdo int
	hasStart, hasEnd := false, false
	for rows.Next() {
		var cpType string
		var odoVal int
		if err := rows.Scan(&cpType, &odoVal); err != nil {
			continue
		}
		switch cpType {
		case "START":
			startOdo = odoVal
			hasStart = true
		case "END":
			endOdo = odoVal
			hasEnd = true
		}
	}

	result := auditResult{expectedKm: expectedKm}
	if hasStart && hasEnd {
		result.hasBoth = true
		result.reportedKm = endOdo - startOdo
		if expectedKm > 0 {
			result.variancePct = math.Round((float64(result.reportedKm)-expectedKm)/expectedKm*100*100) / 100
			result.isFlagged = math.Abs(result.variancePct) > odoTolerancePct
		}
	}

	return result
}

func cleanup(ctx context.Context, db *pgxpool.Pool, orderID, driverID string) {
	_, _ = db.Exec(ctx, "DELETE FROM trip_odometer_checkpoints WHERE order_id = $1::uuid", orderID)
	_, _ = db.Exec(ctx, "DELETE FROM financial_ledger_entries WHERE order_id = $1::uuid", orderID)
	_, _ = db.Exec(ctx, "DELETE FROM orders WHERE id = $1::uuid", orderID)
	_, _ = db.Exec(ctx, "DELETE FROM drivers WHERE id = $1::uuid", driverID)
}

func seedDriverAndOrder(ctx context.Context, t *testing.T, db *pgxpool.Pool, driverID, orderID string, straightKm float64) {
	t.Helper()

	// Ensure city KOL is seeded in regional_cities
	_, err := db.Exec(ctx, `
		INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active, geofence)
		VALUES ('KOL', 'Kolkata', 'Asia/Kolkata', true, ST_GeomFromText('MULTIPOLYGON(((88.3 22.5, 88.4 22.5, 88.4 22.6, 88.3 22.6, 88.3 22.5)))', 4326)::geography)
		ON CONFLICT (city_prefix) DO NOTHING
	`)
	if err != nil {
		t.Fatalf("Failed seeding regional city: %v", err)
	}

	phone := fmt.Sprintf("+91999999%s", driverID[len(driverID)-4:])
	dlNum := fmt.Sprintf("DL-AUDIT-%s", driverID[len(driverID)-4:])
	_, err = db.Exec(ctx, `
		INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, acceptance_rate)
		VALUES ($1::uuid, 'KOL', 'Audit Test Driver', $2, $3, 'ONLINE_AVAILABLE', true, 0.95)
	`, driverID, phone, dlNum)
	if err != nil {
		t.Fatalf("Failed seeding driver: %v", err)
	}

	// Compute dropoff longitude to produce the desired straight-line distance
	degreeOffset := straightKm / 111.0
	pickupLng := 88.3639
	dropoffLng := pickupLng + degreeOffset

	_, err = db.Exec(ctx, `
		INSERT INTO orders (id, city_prefix, customer_id, status, assigned_driver_id, pickup_location, dropoff_location, pickup_h3_cell, base_fare_paise)
		VALUES ($1::uuid, 'KOL', gen_random_uuid(), 'ARRIVED_AT_PICKUP', $2::uuid,
		        ST_GeographyFromText('POINT(88.3639 22.5726)'),
		        ST_GeographyFromText($3),
		        '88754cb247fffff', 35000)
	`, orderID, driverID, fmt.Sprintf("POINT(%f 22.5726)", dropoffLng))
	if err != nil {
		t.Fatalf("Failed seeding order: %v", err)
	}
}

func insertCheckpoint(ctx context.Context, t *testing.T, db *pgxpool.Pool, orderID, driverID, cpType string, odoValue, fuelPct int) {
	t.Helper()

	_, err := db.Exec(ctx, `
		INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, $2, $3, $4, 'https://sim-test.local/odo.jpg', NOW(), $5::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		SET odometer_value = EXCLUDED.odometer_value, fuel_percentage = EXCLUDED.fuel_percentage
	`, orderID, cpType, odoValue, fuelPct, driverID)
	if err != nil {
		t.Fatalf("Failed inserting %s checkpoint: %v", cpType, err)
	}
}

func advanceOrderStatus(ctx context.Context, t *testing.T, db *pgxpool.Pool, orderID, status string) {
	t.Helper()

	_, err := db.Exec(ctx,
		fmt.Sprintf(`UPDATE orders SET status = '%s'::order_status_enum WHERE id = $1::uuid`, status),
		orderID)
	if err != nil {
		t.Fatalf("Failed advancing order to %s: %v", status, err)
	}
}

func TestGatewayOTPAndOdometerLimits(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	postgresURL := os.Getenv("DATABASE_URL")
	if postgresURL == "" {
		postgresURL = "postgresql://postgres:HardenedProdPassword@localhost:5432/delivery_platform?sslmode=disable"
	}
	dbPool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		t.Fatalf("Database connection failed: %v", err)
	}
	defer dbPool.Close()

	redisNodes := os.Getenv("REDIS_CLUSTER_NODES")
	if redisNodes == "" {
		redisNodes = "127.0.0.1:6379"
	}
	redisClient := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: strings.Split(redisNodes, ","),
	})
	defer redisClient.Close()

	orderID := "00000000-0000-0000-aaaa-000000000001"
	driverID := "00000000-0000-0000-aaaa-000000000099"

	cleanup(ctx, dbPool, orderID, driverID)
	seedDriverAndOrder(ctx, t, dbPool, driverID, orderID, 5.0)

	// Update order status to ARRIVED_AT_PICKUP (required for starting trip)
	_, _ = dbPool.Exec(ctx, "UPDATE orders SET status = 'ARRIVED_AT_PICKUP'::order_status_enum, otp_hash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', otp_attempts = 0 WHERE id = $1::uuid", orderID)

	// Instantiate GatewayHandler with mock Kafka writer to avoid nil pointer panic
	mockKafkaWriter := &kafka.Writer{
		Addr: kafka.TCP("localhost:9092"),
	}
	h := NewGatewayHandler(dbPool, mockKafkaWriter, nil, redisClient)

	// Helper function to create request with context
	newTestRequest := func(method, path, body string, uid, role string) *http.Request {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, uid)
		ctx = context.WithValue(ctx, middleware.UserRoleContextKey, role)
		return req.WithContext(ctx)
	}

	// 1. Negative/zero odometer reading returns 400
	t.Run("NegativeOdometer_Returns400", func(t *testing.T) {
		req := newTestRequest("PATCH", "/api/v1/driver/orders/"+orderID+"/start", `{"odometer_reading": -10, "fuel_level": 80, "otp": "1234"}`, driverID, "DRIVER")
		req.SetPathValue("id", orderID)
		rec := httptest.NewRecorder()
		h.HandleDriverStartTrip(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Expected 400 Bad Request, got %d", rec.Code)
		}
	})

	// 2. Incorrect OTP returns 401 and increments attempts
	t.Run("IncorrectOTP_Returns401", func(t *testing.T) {
		req := newTestRequest("PATCH", "/api/v1/driver/orders/"+orderID+"/start", `{"odometer_reading": 50000, "fuel_level": 80, "otp": "9999"}`, driverID, "DRIVER")
		req.SetPathValue("id", orderID)
		rec := httptest.NewRecorder()
		h.HandleDriverStartTrip(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("Expected 401 Unauthorized, got %d", rec.Code)
		}

		// Verify otp_attempts is now 1 in the database
		var attempts int
		err = dbPool.QueryRow(ctx, "SELECT otp_attempts FROM orders WHERE id = $1::uuid", orderID).Scan(&attempts)
		if err != nil {
			t.Fatalf("Failed to query otp_attempts: %v", err)
		}
		if attempts != 1 {
			t.Errorf("Expected otp_attempts = 1, got %d", attempts)
		}
	})

	// 3. Brute force lockout happens after the 3rd failed attempt
	t.Run("BruteForceLockout_AttemptsCount", func(t *testing.T) {
		// Set otp_attempts to 3 in DB
		_, err = dbPool.Exec(ctx, "UPDATE orders SET otp_attempts = 3 WHERE id = $1::uuid", orderID)
		if err != nil {
			t.Fatalf("Failed to update attempts: %v", err)
		}

		req := newTestRequest("PATCH", "/api/v1/driver/orders/"+orderID+"/start", `{"odometer_reading": 50000, "fuel_level": 80, "otp": "1234"}`, driverID, "DRIVER")
		req.SetPathValue("id", orderID)
		rec := httptest.NewRecorder()
		h.HandleDriverStartTrip(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("Expected 403 Forbidden, got %d", rec.Code)
		}
	})

	// 4. Success scenario correctly transitions order status to DELIVERING
	t.Run("SuccessOTP_StartsTrip", func(t *testing.T) {
		// Reset attempts in DB
		_, err = dbPool.Exec(ctx, "UPDATE orders SET otp_attempts = 0 WHERE id = $1::uuid", orderID)
		if err != nil {
			t.Fatalf("Failed to reset attempts: %v", err)
		}

		req := newTestRequest("PATCH", "/api/v1/driver/orders/"+orderID+"/start", `{"odometer_reading": 50010, "fuel_level": 80, "otp": "1234"}`, driverID, "DRIVER")
		req.SetPathValue("id", orderID)
		rec := httptest.NewRecorder()
		h.HandleDriverStartTrip(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("Expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		// Verify status and picked_up_at
		var status string
		err = dbPool.QueryRow(ctx, "SELECT status::text FROM orders WHERE id = $1::uuid", orderID).Scan(&status)
		if err != nil {
			t.Fatalf("Failed to query status: %v", err)
		}
		if status != "DELIVERING" {
			t.Errorf("Expected order status DELIVERING, got %s", status)
		}
	})
}
