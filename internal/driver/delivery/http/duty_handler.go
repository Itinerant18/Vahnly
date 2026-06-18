package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/redis/go-redis/v9"
	"github.com/uber/h3-go/v3"
)

var SOSCallback func(driverID string, tripID string, lat, lng float64)

type DutyHandler struct {
	dbPool        *pgxpool.Pool
	clusterClient *redis.ClusterClient
}

func NewDutyHandler(dbPool *pgxpool.Pool, clusterClient *redis.ClusterClient) *DutyHandler {
	return &DutyHandler{
		dbPool:        dbPool,
		clusterClient: clusterClient,
	}
}

type DutyStateRequest struct {
	DutyState string  `json:"duty_state"` // ONLINE or OFFLINE
	State     string  `json:"state"`      // Alternative: ONLINE or OFFLINE
	Latitude  float64 `json:"latitude"`
	Lat       float64 `json:"lat"`        // Alternative
	Longitude float64 `json:"longitude"`
	Lng       float64 `json:"lng"`        // Alternative
}

// HandleDutyStateToggle handles Online/Offline toggle for drivers
func (h *DutyHandler) HandleDutyStateToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req DutyStateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	state := req.State
	if state == "" {
		state = req.DutyState
	}
	if state != "ONLINE" && state != "OFFLINE" {
		http.Error(w, "Invalid duty state: must be ONLINE or OFFLINE", http.StatusBadRequest)
		return
	}

	lat := req.Latitude
	if lat == 0 {
		lat = req.Lat
	}
	lng := req.Longitude
	if lng == 0 {
		lng = req.Lng
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. Validate KYC Status & City Prefix
	var verificationStatus string
	var cityPrefix string
	var canDriveManual bool
	kycQuery := `SELECT COALESCE(verification_status::text, 'ONBOARDING'), COALESCE(city_prefix, 'KOL'), COALESCE(can_drive_manual, true) FROM drivers WHERE id = $1`
	err := h.dbPool.QueryRow(ctx, kycQuery, driverID).Scan(&verificationStatus, &cityPrefix, &canDriveManual)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Driver profile not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Database read exception", http.StatusInternalServerError)
		return
	}

	if verificationStatus != "VERIFIED" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "driver_not_verified",
			"message": "Driver KYC verification is not completed.",
		})
		return
	}

	// 2. Perform Atomic Update in DB
	var dutyStateStr string
	var currentStateStr string

	if state == "ONLINE" {
		dutyStateStr = "ONLINE"
		currentStateStr = "ONLINE_AVAILABLE"
	} else {
		dutyStateStr = "OFFLINE"
		currentStateStr = "OFFLINE"
	}

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "Transaction initiation failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	updateQuery := `
		UPDATE drivers 
		SET duty_state = $1::driver_duty_state,
		    current_state = $2::driver_state_enum,
		    last_lat = $3,
		    last_lng = $4,
		    updated_at = NOW()
		WHERE id = $5
	`
	var latVal, lngVal interface{}
	if state == "ONLINE" && lat != 0 {
		latVal = lat
		lngVal = lng
	}

	_, err = tx.Exec(ctx, updateQuery, dutyStateStr, currentStateStr, latVal, lngVal, driverID)
	if err != nil {
		http.Error(w, "Failed to update duty state in datastore", http.StatusInternalServerError)
		return
	}

	err = tx.Commit(ctx)
	if err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	// 3. Redis Spatial index sync
	spatialKey := fmt.Sprintf("driver:locations:%s", cityPrefix)
	statusKey := fmt.Sprintf("driver:{%s:%s}:status", cityPrefix, driverID)
	trackerKey := fmt.Sprintf("driver:{%s:%s}:current_cell", cityPrefix, driverID)
	profileKey := fmt.Sprintf("driver:{%s:%s}:profile", cityPrefix, driverID)

	if state == "ONLINE" {
		if h.clusterClient != nil {
			// Add to Geo ZSET
			_ = h.clusterClient.GeoAdd(ctx, spatialKey, &redis.GeoLocation{
				Name:      driverID,
				Longitude: lng,
				Latitude:  lat,
			}).Err()

			// Add to H3 sharded ZSET
			if lat != 0 && lng != 0 {
				latRad := lat * (math.Pi / 180.0)
				lngRad := lng * (math.Pi / 180.0)
				centerCoord := h3.GeoCoord{Latitude: latRad, Longitude: lngRad}
				resolution8Cell := h3.FromGeo(centerCoord, 8)
				h3CellStr := h3.ToString(resolution8Cell)

				spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, h3CellStr)
				nowEpoch := float64(time.Now().Unix())

				pipe := h.clusterClient.Pipeline()
				pipe.ZAdd(ctx, spatialZSetKey, redis.Z{Score: nowEpoch, Member: driverID})
				pipe.Expire(ctx, spatialZSetKey, 24*time.Hour)
				pipe.Set(ctx, trackerKey, h3CellStr, 24*time.Hour)
				pipe.Set(ctx, statusKey, "ONLINE_AVAILABLE", 24*time.Hour)
				// Pre-warm the profile hash for Hungarian matcher. can_drive_manual gates
				// manual-car bookings ("1"/"0"); the scanner defaults absent to capable.
				canManualFlag := "1"
				if !canDriveManual {
					canManualFlag = "0"
				}
				pipe.HSet(ctx, profileKey,
					"osm_node_id",              "1001",
					"acceptance_rate",          "0.95",
					"cancellation_probability", "0.05",
					"can_drive_manual",         canManualFlag,
				)
				pipe.Expire(ctx, profileKey, 24*time.Hour)
				_, _ = pipe.Exec(ctx)
			}
		}
	} else {
		if h.clusterClient != nil {
			// Remove from Geo ZSET
			_ = h.clusterClient.ZRem(ctx, spatialKey, driverID).Err()

			// Retrieve previous H3 cell to evict from sharded spatial ZSET
			previousCell, err := h.clusterClient.Get(ctx, trackerKey).Result()
			if err == nil && previousCell != "" {
				spatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, previousCell)
				_ = h.clusterClient.ZRem(ctx, spatialZSetKey, driverID).Err()
			}

			// Clean up keys
			_ = h.clusterClient.Set(ctx, statusKey, "OFFLINE", 24*time.Hour).Err()
			_ = h.clusterClient.Del(ctx, trackerKey).Err()
		}
	}

	// 4. Real-Time Admin Event for ControlRoomDashboard.tsx
	if h.clusterClient != nil {
		eventData := map[string]interface{}{
			"driver_id": driverID,
			"state":     state,
			"lat":       lat,
			"lng":       lng,
			"timestamp": time.Now(),
		}
		bytes, err := json.Marshal(eventData)
		if err == nil {
			_ = h.clusterClient.Publish(ctx, "admin:active_radar", string(bytes)).Err()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"duty_state": dutyStateStr,
	})
}

// HandleTriggerSOS handles SOS signals from driver terminal
func (h *DutyHandler) HandleTriggerSOS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. Update duty state to EMERGENCY
	_, err := h.dbPool.Exec(ctx, `UPDATE drivers SET duty_state = 'EMERGENCY'::driver_duty_state, updated_at = NOW() WHERE id = $1`, driverID)
	if err != nil {
		http.Error(w, "Failed updating duty state to emergency", http.StatusInternalServerError)
		return
	}

	// 2. Resolve the driver's ACTIVE trip, if any. A driver can trigger SOS with no
	// active trip; in that case the alert stands alone (trip_id NULL, migration 073)
	// rather than being mis-attributed to a random/completed order.
	var tripID string
	tripQuery := `
		SELECT id FROM orders
		WHERE assigned_driver_id = $1
		  AND status IN ('ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'DELIVERING')
		ORDER BY created_at DESC
		LIMIT 1
	`
	if err = h.dbPool.QueryRow(ctx, tripQuery, driverID).Scan(&tripID); err != nil {
		tripID = "" // no active trip — file a standalone SOS
	}

	// 3. Get driver last known lat/lng
	var lastLat, lastLng *float64
	var driverName string
	_ = h.dbPool.QueryRow(ctx, "SELECT name, last_lat, last_lng FROM drivers WHERE id = $1", driverID).Scan(&driverName, &lastLat, &lastLng)
	
	lat := 22.5726
	lng := 88.3639
	if lastLat != nil {
		lat = *lastLat
	}
	if lastLng != nil {
		lng = *lastLng
	}

	// 4. Insert into safety_sos_alerts
	sosID := fmt.Sprintf("SOS-%d", (time.Now().UnixNano()/1000)%100000)
	audio := "https://platform-safety-recordings.s3.amazonaws.com/sos/" + sosID + ".mp3"
	
	var tripIDArg interface{}
	if tripID != "" {
		tripIDArg = tripID
	}
	insertQuery := `
		INSERT INTO safety_sos_alerts (id, trip_id, reporter_type, status, audio_stream_url, latitude, longitude, notes)
		VALUES ($1, $2::uuid, 'DRIVER', 'ACTIVE', $3, $4, $5, 'SOS alert triggered from driver operational cockpit.')
	`
	_, err = h.dbPool.Exec(ctx, insertQuery, sosID, tripIDArg, audio, lat, lng)
	if err != nil {
		http.Error(w, "Failed registering SOS alert record", http.StatusInternalServerError)
		return
	}

	// 5. Trigger bound safety callback to alert admin Incident Recovery Dashboard
	if SOSCallback != nil {
		SOSCallback(driverID, tripID, lat, lng)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"sos_id":  sosID,
		"trip_id": tripID,
		"message": "SOS alert registered and escalations triggered successfully.",
	})
}

// HandleGetStats fetches driver performance statistics
func (h *DutyHandler) HandleGetStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. Get Completed Trips Today
	var tripsToday int64
	tripsQuery := `
		SELECT COUNT(*) FROM orders 
		WHERE assigned_driver_id = $1 
		  AND status = 'COMPLETED'::order_status_enum 
		  AND completed_at >= CURRENT_DATE
	`
	_ = h.dbPool.QueryRow(ctx, tripsQuery, driverID).Scan(&tripsToday)

	// 2. Get Earnings Today (Driver share credit from completed trips today)
	var earningsTodayPaise int64
	earningsQuery := `
		SELECT COALESCE(SUM(fle.amount_paise), 0) 
		FROM financial_ledger_entries fle
		JOIN orders o ON o.id = fle.order_id
		WHERE o.assigned_driver_id = $1 
		  AND fle.account_type = 'DRIVER_EARNINGS' 
		  AND fle.entry_type = 'CREDIT' 
		  AND o.completed_at >= CURRENT_DATE
	`
	_ = h.dbPool.QueryRow(ctx, earningsQuery, driverID).Scan(&earningsTodayPaise)

	// 3. Get Driver Rating
	var rating float64
	_ = h.dbPool.QueryRow(ctx, "SELECT COALESCE(rating, 5.0) FROM drivers WHERE id = $1", driverID).Scan(&rating)

	// 4. Calculate Online Hours (based on last_login_at difference)
	var lastLogin *time.Time
	_ = h.dbPool.QueryRow(ctx, "SELECT last_login_at FROM drivers WHERE id = $1", driverID).Scan(&lastLogin)
	onlineHours := 4.5
	if lastLogin != nil {
		hours := time.Since(*lastLogin).Hours()
		if hours > 0.1 {
			onlineHours = math.Min(hours, 12.0) // cap at 12 hours for realistic view
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"trips_count":       tripsToday,
		"earnings_rupees":   float64(earningsTodayPaise) / 100.0,
		"online_hours":      math.Round(onlineHours*10) / 10,
		"acceptance_rate":   96.0, // mock base
		"rating":            rating,
	})
}

type OTPVerifyRequest struct {
	OTP            string `json:"otp"`
	StartOdometer  int    `json:"start_odometer"`
	FuelPercentage int    `json:"fuel_percentage"`
}

// HandleVerifyOTPAndStartTrip validates OTP and starts order transition
func (h *DutyHandler) HandleVerifyOTPAndStartTrip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	driverID, ok := middleware.GetUserIDFromContext(r.Context())
	if !ok || driverID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "Missing order ID parameter", http.StatusBadRequest)
		return
	}

	var req OTPVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	if req.OTP == "" {
		http.Error(w, "missing_otp", http.StatusBadRequest)
		return
	}

	if req.StartOdometer <= 0 {
		http.Error(w, "invalid_odometer_reading: must be a positive integer", http.StatusBadRequest)
		return
	}

	if req.FuelPercentage < 0 || req.FuelPercentage > 100 {
		req.FuelPercentage = max(0, min(100, req.FuelPercentage))
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Atomic Transaction (update order status to DELIVERING, update driver states)
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "Transaction initiation failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 1. Fetch current status, assigned_driver_id, otp_hash, otp_attempts
	var currentStatus string
	var assignedDriverID *string
	var otpHash *string
	var otpAttempts int
	query := `
		SELECT status::text, assigned_driver_id::text, otp_hash, otp_attempts 
		FROM orders 
		WHERE id = $1::uuid 
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, orderID).Scan(&currentStatus, &assignedDriverID, &otpHash, &otpAttempts)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Order not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Database read error", http.StatusInternalServerError)
		return
	}

	if currentStatus != "ARRIVED_AT_PICKUP" {
		http.Error(w, fmt.Sprintf("invalid_state: expected ARRIVED_AT_PICKUP, got %s", currentStatus), http.StatusConflict)
		return
	}
	if assignedDriverID == nil || *assignedDriverID != driverID {
		http.Error(w, "forbidden: driver identity mismatch", http.StatusForbidden)
		return
	}

	// 2. OTP brute-force lockout guard
	if otpAttempts >= 3 {
		http.Error(w, "too_many_otp_attempts", http.StatusForbidden)
		return
	}

	// Compare hashed OTP
	sum := sha256.Sum256([]byte(req.OTP))
	inputHash := hex.EncodeToString(sum[:])
	
	targetHash := ""
	if otpHash != nil {
		targetHash = *otpHash
	}
	if targetHash == "" {
		// Fail closed: no provisioned OTP means the trip cannot be started (was "1234").
		http.Error(w, "otp_not_provisioned", http.StatusConflict)
		return
	}

	if inputHash != targetHash {
		// Increment otp_attempts
		_, _ = tx.Exec(ctx, "UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = $1::uuid", orderID)
		_ = tx.Commit(ctx) // Commit the increment to DB
		
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "invalid_otp",
			"message": fmt.Sprintf("Incorrect OTP entered. Attempt %d of 3.", otpAttempts+1),
		})
		return
	}

	// 3. Write START odometer checkpoint
	_, err = tx.Exec(ctx, `
		INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, 'START', $2, $3, '', NOW(), $4::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		SET odometer_value = EXCLUDED.odometer_value,
		    fuel_percentage = EXCLUDED.fuel_percentage,
		    captured_at = EXCLUDED.captured_at
	`, orderID, req.StartOdometer, req.FuelPercentage, driverID)
	if err != nil {
		http.Error(w, "Failed to write odometer checkpoint", http.StatusInternalServerError)
		return
	}

	// 4. Update order status to DELIVERING, picked_up_at = NOW(), and reset otp_attempts
	_, err = tx.Exec(ctx, `
		UPDATE orders 
		SET status = 'DELIVERING'::order_status_enum,
		    picked_up_at = NOW(),
		    otp_attempts = 0
		WHERE id = $1::uuid
	`, orderID)
	if err != nil {
		http.Error(w, "Failed to update order status", http.StatusInternalServerError)
		return
	}

	// 5. Update driver state to DELIVERING / ONLINE_DELIVERING
	_, err = tx.Exec(ctx, `
		UPDATE drivers 
		SET duty_state = 'DELIVERING'::driver_duty_state,
		    current_state = 'ONLINE_DELIVERING'::driver_state_enum,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, driverID)
	if err != nil {
		http.Error(w, "Failed to update driver state", http.StatusInternalServerError)
		return
	}

	err = tx.Commit(ctx)
	if err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"status":  "DELIVERING",
	})
}
