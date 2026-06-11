package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// A local shim to match the user's expected signature URLParam without requiring external v1 dependencies
type chiShim struct{}
func (chiShim) URLParam(r *http.Request, key string) string {
	return r.PathValue(key)
}
var chi chiShim

type DriverTripHandler struct {
	dbPool        *pgxpool.Pool
	clusterClient *redis.ClusterClient
}

func NewDriverTripHandler(dbPool *pgxpool.Pool, clusterClient *redis.ClusterClient) *DriverTripHandler {
	return &DriverTripHandler{
		dbPool:        dbPool,
		clusterClient: clusterClient,
	}
}

// MarkArrived handles PATCH /api/v1/driver/orders/{id}/arrived
func (h *DriverTripHandler) MarkArrived(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "Transaction failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 1. Fetch current status, assigned_driver_id
	var currentStatus string
	var assignedDriverID *string
	err = tx.QueryRow(ctx, "SELECT status::text, assigned_driver_id::text FROM orders WHERE id = $1::uuid FOR UPDATE", orderID).Scan(&currentStatus, &assignedDriverID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if currentStatus != "EN_ROUTE_TO_PICKUP" {
		http.Error(w, fmt.Sprintf("invalid_state: expected EN_ROUTE_TO_PICKUP, got %s", currentStatus), http.StatusConflict)
		return
	}

	// 2. Update Database Status to ARRIVED & start Wait Timer anchor
	_, err = tx.Exec(ctx, `
		UPDATE orders 
		SET status = 'ARRIVED_AT_PICKUP'::order_status_enum,
		    waiting_started_at = NOW()
		WHERE id = $1::uuid
	`, orderID)
	if err != nil {
		http.Error(w, "Failed to update order status", http.StatusInternalServerError)
		return
	}

	// Update driver's state
	if assignedDriverID != nil {
		_, err = tx.Exec(ctx, `
			UPDATE drivers 
			SET duty_state = 'ARRIVED'::driver_duty_state,
			    current_state = 'ONLINE_EN_ROUTE'::driver_state_enum,
			    updated_at = NOW()
			WHERE id = $1::uuid
		`, *assignedDriverID)
		if err != nil {
			http.Error(w, "Failed to update driver state", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Commit failed", http.StatusInternalServerError)
		return
	}

	// 3. Publish to EventBus -> Triggers Push Notification to Rider App
	if h.clusterClient != nil {
		eventPayload := map[string]interface{}{
			"order_id":  orderID,
			"status":    "ARRIVED",
			"timestamp": time.Now(),
		}
		bytes, _ := json.Marshal(eventPayload)
		_ = h.clusterClient.Publish(ctx, "trip.status_changed", string(bytes)).Err()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "arrived"})
}

// VerifyAndStartTrip handles PATCH /api/v1/driver/orders/{id}/verify-start
func (h *DriverTripHandler) VerifyAndStartTrip(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		OTP            string `json:"otp"`
		StartOdometer  int    `json:"start_odometer"`
		FuelPercentage int    `json:"fuel_percentage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "Transaction initiation failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Fetch current status, assigned_driver_id, otp_hash, otp_attempts
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
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "Database read error", http.StatusInternalServerError)
		return
	}

	if currentStatus != "ARRIVED_AT_PICKUP" {
		http.Error(w, fmt.Sprintf("invalid_state: expected ARRIVED_AT_PICKUP, got %s", currentStatus), http.StatusConflict)
		return
	}

	if assignedDriverID == nil {
		http.Error(w, "driver_not_assigned", http.StatusForbidden)
		return
	}

	// Lockout guard (max 3 attempts)
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
		_, _ = tx.Exec(ctx, "UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = $1::uuid", orderID)
		_ = tx.Commit(ctx) // Commit the increment

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "invalid_otp",
			"message": fmt.Sprintf("Incorrect OTP entered. Attempt %d of 3.", otpAttempts+1),
		})
		return
	}

	// 2. Insert the mandatory START telemetry into trip_odometer_checkpoints
	_, err = tx.Exec(ctx, `
		INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, 'START', $2, $3, '', NOW(), $4::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		SET odometer_value = EXCLUDED.odometer_value,
		    fuel_percentage = EXCLUDED.fuel_percentage,
		    captured_at = EXCLUDED.captured_at
	`, orderID, req.StartOdometer, req.FuelPercentage, *assignedDriverID)
	if err != nil {
		http.Error(w, "Failed to write odometer checkpoint", http.StatusInternalServerError)
		return
	}

	// 3. Transition order to DELIVERING and update driver state
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

	_, err = tx.Exec(ctx, `
		UPDATE drivers 
		SET duty_state = 'DELIVERING'::driver_duty_state,
		    current_state = 'ONLINE_DELIVERING'::driver_state_enum,
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, *assignedDriverID)
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
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "trip_started"})
}
