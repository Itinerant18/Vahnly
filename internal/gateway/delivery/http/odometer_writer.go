package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// HandleDriverOdometerCheckpoint ingests a START/END odometer + fuel + photo
// checkpoint from the driver app into trip_odometer_checkpoints (the table the
// admin Odometer Audit UI reads). It is the production source that replaces the
// seeded audit data.
//
// Design notes:
//   - Auth: requireDriverIdentity (DRIVER-role JWT); the caller must additionally
//     be the order's assigned_driver_id.
//   - Idempotent UPSERT so the driver app's retry/backoff loop is safe on flaky
//     mobile networks (no duplicate rows, last write wins per checkpoint).
//   - Validation: START before END, and END odometer strictly greater than START.
//   - It does NOT mutate orders.status. Trip lifecycle transitions are owned by
//     /api/v1/trip/start and /api/v1/trip/complete; the enum has no TRIP_STARTED/
//     TRIP_COMPLETED states, and conflating them here would corrupt dispatch state.
func (h *GatewayHandler) HandleDriverOdometerCheckpoint(w http.ResponseWriter, r *http.Request) {
	authDriverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	orderID := r.PathValue("id")
	if orderID == "" {
		http.Error(w, "missing_order_id", http.StatusBadRequest)
		return
	}

	var req struct {
		CheckpointType  string `json:"checkpoint_type"`
		OdometerReading int    `json:"odometer_reading"`
		FuelLevel       int    `json:"fuel_level"`
		PhotoURL        string `json:"photo_url"`
		Timestamp       string `json:"timestamp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.CheckpointType != "START" && req.CheckpointType != "END" {
		http.Error(w, "invalid_checkpoint_type", http.StatusBadRequest)
		return
	}
	if req.OdometerReading <= 0 {
		http.Error(w, "invalid_odometer_reading", http.StatusBadRequest)
		return
	}
	if req.FuelLevel < 0 || req.FuelLevel > 100 {
		http.Error(w, "invalid_fuel_level", http.StatusBadRequest)
		return
	}

	capturedAt := time.Now()
	if req.Timestamp != "" {
		if t, err := time.Parse(time.RFC3339, req.Timestamp); err == nil {
			capturedAt = t
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// Authorization: only the order's assigned driver may write its odometer.
	var assignedDriver *string
	if err := h.dbPool.QueryRow(ctx, `SELECT assigned_driver_id::text FROM orders WHERE id = $1::uuid`, orderID).Scan(&assignedDriver); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "order_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "order_lookup_failed", http.StatusInternalServerError)
		return
	}
	if assignedDriver == nil || *assignedDriver != authDriverID {
		http.Error(w, "driver_identity_mismatch", http.StatusForbidden)
		return
	}

	// Sequence + validity: END requires an existing START and must exceed it.
	var startVal *int
	_ = h.dbPool.QueryRow(ctx,
		`SELECT odometer_value FROM trip_odometer_checkpoints WHERE order_id = $1::uuid AND checkpoint_type = 'START'`,
		orderID).Scan(&startVal)
	if req.CheckpointType == "END" {
		if startVal == nil {
			http.Error(w, "start_checkpoint_required_first", http.StatusBadRequest)
			return
		}
		if req.OdometerReading <= *startVal {
			http.Error(w, "end_odometer_must_exceed_start", http.StatusBadRequest)
			return
		}
	}

	var existed bool
	_ = h.dbPool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM trip_odometer_checkpoints WHERE order_id = $1::uuid AND checkpoint_type = $2)`,
		orderID, req.CheckpointType).Scan(&existed)

	// Idempotent write — safe to replay under the driver app's retry/backoff loop.
	_, err := h.dbPool.Exec(ctx, `
		INSERT INTO trip_odometer_checkpoints
		    (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at, created_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
		ON CONFLICT (order_id, checkpoint_type) DO UPDATE
		    SET odometer_value  = EXCLUDED.odometer_value,
		        fuel_percentage = EXCLUDED.fuel_percentage,
		        photo_url       = EXCLUDED.photo_url,
		        captured_at     = EXCLUDED.captured_at,
		        created_by      = EXCLUDED.created_by`,
		orderID, req.CheckpointType, req.OdometerReading, req.FuelLevel, req.PhotoURL, capturedAt, authDriverID)
	if err != nil {
		http.Error(w, "odometer_write_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if existed {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusCreated)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":          "recorded",
		"order_id":        orderID,
		"checkpoint_type": req.CheckpointType,
		"odometer_value":  req.OdometerReading,
	})
}
