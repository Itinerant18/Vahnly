package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OfflinePacket struct {
	Type       string    `json:"type"` // "TELEMETRY" | "TRIP_EVENT" | "CHECKPOINT"
	Payload    string    `json:"payload"`
	CapturedAt time.Time `json:"captured_at"`
}

type SyncPayload struct {
	OrderID           string          `json:"order_id"`
	DeviceFingerprint string          `json:"device_fingerprint"`
	Packets           []OfflinePacket `json:"packets"`
}

type OfflineSyncHandler struct {
	dbPool *pgxpool.Pool
}

func NewOfflineSyncHandler(dbPool *pgxpool.Pool) *OfflineSyncHandler {
	return &OfflineSyncHandler{
		dbPool: dbPool,
	}
}

// POST /api/v1/driver/sync/offline-payload
func (h *OfflineSyncHandler) BulkReconcileOfflineData(w http.ResponseWriter, r *http.Request) {
	// Driver identity is taken only from the verified JWT — never from a client
	// header. Trusting X-Driver-ID let any caller replay/forge telemetry under an
	// arbitrary driver id and inflate billable distance.
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}

	var req SyncPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	orderID, err := uuid.Parse(req.OrderID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	processedCount := 0
	var earliestCapturedAt time.Time

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	for _, packet := range req.Packets {
		if earliestCapturedAt.IsZero() || packet.CapturedAt.Before(earliestCapturedAt) {
			earliestCapturedAt = packet.CapturedAt
		}

		if packet.Type == "TELEMETRY" {
			lat, lng, parseErr := parseTelemetryPayload(packet.Payload)
			if parseErr != nil {
				continue
			}

			// Reject out-of-range coordinates and the null-island (0,0) sentinel so a
			// client cannot inject fabricated fixes into the billable GPS trail.
			if lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat == 0 && lng == 0) {
				continue
			}

			_, dbErr := tx.Exec(ctx, `
				INSERT INTO orders_gps_trail (order_id, latitude, longitude, captured_at, client_captured_at, is_synced_offline)
				VALUES ($1::uuid, $2, $3, NOW(), $4, TRUE)
			`, orderID, lat, lng, packet.CapturedAt)

			if dbErr == nil {
				processedCount++
			}
		}
	}

	if earliestCapturedAt.IsZero() {
		earliestCapturedAt = time.Now()
	}

	_, sessionErr := tx.Exec(ctx, `
		INSERT INTO driver_offline_sync_sessions (driver_id, session_started_at, sync_completed_at, total_packets_processed, device_fingerprint)
		VALUES ($1::uuid, $2, NOW(), $3, $4)
	`, driverID, earliestCapturedAt, processedCount, req.DeviceFingerprint)

	if sessionErr != nil {
		log.Printf("[OFFLINE_SYNC] Failed logging sync session: %v", sessionErr)
	}

	if commitErr := tx.Commit(ctx); commitErr != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"sync_complete","reconciled_packets":` + strconv.Itoa(processedCount) + `}`))
}

func parseTelemetryPayload(payload string) (float64, float64, error) {
	// Try parsing as JSON first
	var coords struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Lat       float64 `json:"lat"`
		Lng       float64 `json:"lng"`
	}
	if err := json.Unmarshal([]byte(payload), &coords); err == nil {
		lat := coords.Latitude
		if lat == 0 {
			lat = coords.Lat
		}
		lng := coords.Longitude
		if lng == 0 {
			lng = coords.Lng
		}
		if lat != 0 || lng != 0 {
			return lat, lng, nil
		}
	}

	// Fallback to text parsing (e.g. "lat:22.5,lng:88.3")
	var lat, lng float64
	_, err := fmt.Sscanf(payload, "lat:%f,lng:%f", &lat, &lng)
	if err == nil {
		return lat, lng, nil
	}

	// Try with spaces "lat: 22.5, lng: 88.3"
	_, err = fmt.Sscanf(payload, "lat: %f, lng: %f", &lat, &lng)
	if err == nil {
		return lat, lng, nil
	}

	return 0, 0, fmt.Errorf("unable to parse coordinates from payload: %s", payload)
}
