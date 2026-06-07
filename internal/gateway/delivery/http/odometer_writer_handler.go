package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// HandleDriverOdometerCheckpoint is the driver-facing POST handler that captures
// odometer/fuel checkpoints at trip START and END. It serves as the single point
// of truth for physical asset state, writing to trip_odometer_checkpoints and
// atomically advancing the order lifecycle status in one transaction.
//
// Route: POST /api/v1/driver/orders/{id}/odometer
//
// Validation guards:
//   - checkpoint_type must be "START" or "END"
//   - odometer_reading must be > 0
//   - END is rejected if no START checkpoint exists (sequence check)
//   - END odometer_reading must be > START odometer_reading (reading validity)
//
// Transactional guarantees:
//   - START: inserts checkpoint + transitions order to DELIVERING
//   - END:   inserts checkpoint + transitions order to COMPLETED, resets driver
//   - Upsert semantics (ON CONFLICT … DO UPDATE) for safe client retries
func (h *GatewayHandler) HandleDriverOdometerCheckpoint(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		CheckpointType  string  `json:"checkpoint_type"`
		OdometerReading int     `json:"odometer_reading"`
		FuelLevel       int     `json:"fuel_level"`
		PhotoURL        string  `json:"photo_url"`
		Timestamp       *string `json:"timestamp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	// --- Field validation ---
	if req.CheckpointType != "START" && req.CheckpointType != "END" {
		http.Error(w, "invalid_checkpoint_type: must be START or END", http.StatusBadRequest)
		return
	}
	if req.OdometerReading <= 0 {
		http.Error(w, "invalid_odometer_reading: must be a positive integer", http.StatusBadRequest)
		return
	}
	if req.FuelLevel < 0 || req.FuelLevel > 100 {
		req.FuelLevel = max(0, min(100, req.FuelLevel)) // clamp silently
	}

	capturedAt := time.Now().UTC()
	if req.Timestamp != nil && *req.Timestamp != "" {
		if parsed, err := time.Parse(time.RFC3339, *req.Timestamp); err == nil {
			capturedAt = parsed.UTC()
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// --- Verify order exists and fetch current status + assigned driver ---
	var currentStatus string
	var assignedDriverID *string
	err := h.dbPool.QueryRow(ctx,
		`SELECT status::text, assigned_driver_id::text FROM orders WHERE id = $1::uuid`,
		orderID).Scan(&currentStatus, &assignedDriverID)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		log.Printf("[ODOMETER_WRITER] Order lookup failed for %s: %v", orderID, err)
		http.Error(w, "datastore_read_exception", http.StatusInternalServerError)
		return
	}

	// --- Sequence & state-machine validation ---
	if req.CheckpointType == "START" {
		// START is valid from ARRIVED_AT_PICKUP (normal flow) or EN_ROUTE_TO_PICKUP (early capture)
		if currentStatus != "ARRIVED_AT_PICKUP" && currentStatus != "EN_ROUTE_TO_PICKUP" {
			http.Error(w, fmt.Sprintf("invalid_state_for_start_checkpoint: order is %s, expected ARRIVED_AT_PICKUP or EN_ROUTE_TO_PICKUP", currentStatus), http.StatusConflict)
			return
		}
	} else {
		// END requires the order to already be DELIVERING
		if currentStatus != "DELIVERING" {
			http.Error(w, fmt.Sprintf("invalid_state_for_end_checkpoint: order is %s, expected DELIVERING", currentStatus), http.StatusConflict)
			return
		}

		// Sequence check: START checkpoint must exist before END is accepted
		var startReading int
		err := h.dbPool.QueryRow(ctx,
			`SELECT odometer_value FROM trip_odometer_checkpoints WHERE order_id = $1::uuid AND checkpoint_type = 'START'`,
			orderID).Scan(&startReading)
		if err != nil {
			if err == pgx.ErrNoRows {
				http.Error(w, "sequence_violation: START checkpoint must be captured before END", http.StatusUnprocessableEntity)
				return
			}
			log.Printf("[ODOMETER_WRITER] START checkpoint lookup failed for order %s: %v", orderID, err)
			http.Error(w, "datastore_read_exception", http.StatusInternalServerError)
			return
		}

		// Reading validity: END odometer must exceed START odometer
		if req.OdometerReading <= startReading {
			http.Error(w, fmt.Sprintf("invalid_end_reading: end odometer (%d) must be greater than start odometer (%d). Please re-read the odometer.", req.OdometerReading, startReading), http.StatusBadRequest)
			return
		}
	}

	// --- Atomic transaction: checkpoint insert + status transition ---
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		log.Printf("[ODOMETER_WRITER] Transaction begin failed for order %s: %v", orderID, err)
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Upsert checkpoint (safe for client retries under network jitter)
	var checkpointID string
	err = tx.QueryRow(ctx, `
		INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		SET odometer_value = EXCLUDED.odometer_value,
		    fuel_percentage = EXCLUDED.fuel_percentage,
		    photo_url       = EXCLUDED.photo_url,
		    captured_at     = EXCLUDED.captured_at
		RETURNING id::text`,
		orderID, req.CheckpointType, req.OdometerReading, req.FuelLevel, req.PhotoURL, capturedAt,
		assignedDriverID,
	).Scan(&checkpointID)
	if err != nil {
		log.Printf("[ODOMETER_WRITER] Checkpoint upsert failed for order %s: %v", orderID, err)
		http.Error(w, "checkpoint_write_failed", http.StatusInternalServerError)
		return
	}

	// Advance trip lifecycle status atomically
	if req.CheckpointType == "START" {
		_, err = tx.Exec(ctx,
			`UPDATE orders SET status = 'DELIVERING'::order_status_enum WHERE id = $1::uuid`,
			orderID)
		if err != nil {
			log.Printf("[ODOMETER_WRITER] Status transition to DELIVERING failed for order %s: %v", orderID, err)
			http.Error(w, "status_transition_failed", http.StatusInternalServerError)
			return
		}

		// Also update the driver state to ONLINE_DELIVERING
		if assignedDriverID != nil && *assignedDriverID != "" {
			_, _ = tx.Exec(ctx,
				`UPDATE drivers SET current_state = 'ONLINE_DELIVERING'::driver_state_enum, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
				*assignedDriverID)
		}
	} else {
		// END checkpoint: complete the trip and free the driver
		_, err = tx.Exec(ctx,
			`UPDATE orders SET status = 'COMPLETED'::order_status_enum, completed_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
			orderID)
		if err != nil {
			log.Printf("[ODOMETER_WRITER] Status transition to COMPLETED failed for order %s: %v", orderID, err)
			http.Error(w, "status_transition_failed", http.StatusInternalServerError)
			return
		}

		// Reset driver to available pool
		if assignedDriverID != nil && *assignedDriverID != "" {
			_, _ = tx.Exec(ctx,
				`UPDATE drivers SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
				*assignedDriverID)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[ODOMETER_WRITER] Transaction commit failed for order %s: %v", orderID, err)
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	// Determine the new status for the response
	newStatus := "DELIVERING"
	if req.CheckpointType == "END" {
		newStatus = "COMPLETED"
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":               checkpointID,
		"order_id":         orderID,
		"checkpoint_type":  req.CheckpointType,
		"odometer_reading": req.OdometerReading,
		"fuel_level":       req.FuelLevel,
		"photo_url":        req.PhotoURL,
		"captured_at":      capturedAt.Format(time.RFC3339),
		"status":           newStatus,
	})

	log.Printf("[ODOMETER_WRITER] %s checkpoint recorded for order %s — odometer=%d km, fuel=%d%%, status→%s",
		req.CheckpointType, orderID, req.OdometerReading, req.FuelLevel, newStatus)
}
