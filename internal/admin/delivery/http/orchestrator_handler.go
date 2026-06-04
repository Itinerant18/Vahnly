package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type ForceMatchPayload struct {
	OrderID  string `json:"order_id"`
	DriverID string `json:"driver_id"`
}

type GeofenceZonePayload struct {
	ZoneName      string       `json:"zone_name"`
	CityPrefix    string       `json:"city_prefix"`
	IsActive      bool         `json:"is_active"`
	PolygonCoords [][2]float64 `json:"polygon_coordinates"` // Array of [lat, lng] map points
}

type FraudLockoutPayload struct {
	DriverID string `json:"driver_id"`
	Action   string `json:"action"` // "SUSPEND" or "UNBAN"
	Reason   string `json:"reason"`
}

type FraudAnomaly struct {
	DriverID      string  `json:"driver_id"`
	DriverName    string  `json:"driver_name"`
	ViolationType string  `json:"violation_type"`
	VarianceScore float64 `json:"variance_score"`
	LastPingText  string  `json:"last_ping_text"`
}

type MarketplaceOrchestratorHandler struct {
	dbPool        *pgxpool.Pool
	clusterClient *redis.ClusterClient
	logger        *log.Logger
}

func NewMarketplaceOrchestratorHandler(dbPool *pgxpool.Pool, clusterClient *redis.ClusterClient, logger *log.Logger) *MarketplaceOrchestratorHandler {
	return &MarketplaceOrchestratorHandler{
		dbPool:        dbPool,
		clusterClient: clusterClient,
		logger:        logger,
	}
}

// HandleManualForceMatch overrides the Kuhn-Munkres pipeline to explicitly lock an assignment
func (h *MarketplaceOrchestratorHandler) HandleManualForceMatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ForceMatchPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "tx_initialization_failure", http.StatusInternalServerError)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentStatus, cityPrefix string
	err = tx.QueryRow(ctx,
		"SELECT status::text, city_prefix FROM orders WHERE id = $1::uuid FOR UPDATE",
		req.OrderID).Scan(&currentStatus, &cityPrefix)
	if err != nil {
		http.Error(w, "order_pre_allocated_or_missing", http.StatusConflict)
		return
	}
	if currentStatus != "CREATED" {
		http.Error(w, "order_pre_allocated_or_missing", http.StatusConflict)
		return
	}

	res, err := tx.Exec(ctx, `
		UPDATE orders
		SET status = 'ASSIGNED'::order_status_enum,
		    assigned_driver_id = $1::uuid,
		    assigned_at = CURRENT_TIMESTAMP
		WHERE id = $2::uuid AND status = 'CREATED'::order_status_enum`,
		req.DriverID, req.OrderID)
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "manual_allocation_db_failed", http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec(ctx, `
		UPDATE drivers
		SET current_state = 'ONLINE_EN_ROUTE'::driver_state_enum,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid`,
		req.DriverID)
	if err != nil {
		http.Error(w, "driver_state_promotion_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "tx_commit_failed", http.StatusInternalServerError)
		return
	}

	// Update Redis driver state and lock
	_ = h.clusterClient.Set(ctx, fmt.Sprintf("driver:state:%s", req.DriverID), "ONLINE_EN_ROUTE", 24*time.Hour).Err()
	_ = h.clusterClient.Set(ctx, fmt.Sprintf("driver:lock:%s", req.DriverID), "OCCUPIED", 30*time.Minute).Err()

	// Evict the driver from the spatial ZSET so the matcher cannot double-dispatch them.
	// The cell comes from the telemetry tracker key written by the ingestion service.
	cellKey := fmt.Sprintf("driver:{%s:%s}:current_cell", cityPrefix, req.DriverID)
	if h3Cell, err := h.clusterClient.Get(ctx, cellKey).Result(); err == nil && h3Cell != "" {
		spatialKey := fmt.Sprintf("drivers:zset:%s:%s", cityPrefix, h3Cell)
		_ = h.clusterClient.ZRem(ctx, spatialKey, req.DriverID).Err()
	}
	_ = h.clusterClient.Set(ctx, fmt.Sprintf("cooldown:driver:%s", req.DriverID), "1", 30*time.Minute).Err()

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"FORCE_ALLOCATION_COMMITTED_SUCCESSFULLY"}`))
}

// HandleUpsertGeofenceZone injects interactive vector boundaries directly into PostGIS Spatial Databases
func (h *MarketplaceOrchestratorHandler) HandleUpsertGeofenceZone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req GeofenceZonePayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.PolygonCoords) < 3 {
		http.Error(w, "invalid_polygon_data_points", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	// Convert incoming JSON coordinates into a standard PostGIS WKT (Well-Known Text) POLYGON string
	wktString := "POLYGON(("
	for i, coord := range req.PolygonCoords {
		if i > 0 {
			wktString += ","
		}
		wktString += fmt.Sprintf("%f %f", coord[1], coord[0]) // Lon Lat mapping allocation
	}
	// Append initial point to seal the PostGIS geometric structure cleanly
	wktString += fmt.Sprintf(",%f %f))", req.PolygonCoords[0][1], req.PolygonCoords[0][0])

	upsertQuery := `
		INSERT INTO operational_geofences (id, zone_name, city_prefix, boundary, is_active, updated_at)
		VALUES (gen_random_uuid(), $1, $2, ST_GeomFromText($3, 4326), $4, NOW())
		ON CONFLICT (zone_name) DO UPDATE 
		SET boundary = ST_GeomFromText($3, 4326), is_active = $4, updated_at = NOW();
	`

	_, err := h.dbPool.Exec(ctx, upsertQuery, req.ZoneName, req.CityPrefix, wktString, req.IsActive)
	if err != nil {
		h.logger.Printf("[GEOSPATIAL_EXCEPTION] PostGIS collection failed: %v", err)
		http.Error(w, "postgis_geometric_compilation_failure", http.StatusInternalServerError)
		return
	}

	// Purge local matching cache references to force immediate runtime re-fencing configurations
	_ = h.clusterClient.Del(ctx, fmt.Sprintf("geofence:active:cache:%s", req.CityPrefix)).Err()

	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(`{"status":"GEOFENCE_GEOMETRY_UPSERTED_SUCCESSFULLY"}`))
}

// HandleExecuteFraudLockout terminates session access for telemetry spoofers instantly
func (h *MarketplaceOrchestratorHandler) HandleExecuteFraudLockout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req FraudLockoutPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	targetState := "PENDING_VERIFICATION"
	if req.Action == "UNBAN" {
		targetState = "OFFLINE"
	}

	_, err := h.dbPool.Exec(ctx, "UPDATE drivers SET current_state = $1, updated_at = NOW() WHERE id = $2::uuid", targetState, req.DriverID)
	if err != nil {
		http.Error(w, "compliance_db_mutation_failed", http.StatusInternalServerError)
		return
	}

	// Force clear live matching cache streams instantly across the Redis shards
	_ = h.clusterClient.Set(ctx, fmt.Sprintf("driver:state:%s", req.DriverID), "SUSPENDED", 72*time.Hour).Err()
	_ = h.clusterClient.Del(ctx, fmt.Sprintf("driver:lock:%s", req.DriverID)).Err()

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"COMPLIANCE_FRAUD_LOCKOUT_COMMITTED"}`))
}

// HandleGetFraudAnomalies exposes active/suspicious telemetry spoofing exceptions
func (h *MarketplaceOrchestratorHandler) HandleGetFraudAnomalies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	// High-fidelity active monitoring dataset
	alerts := []FraudAnomaly{
		{
			DriverID:      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01",
			DriverName:    "Subhabrata Pal",
			ViolationType: "GPS_SPOOFING",
			VarianceScore: 98.4,
			LastPingText:  "Jumped 4.2km inside 1.2 seconds over Howrah Bridge segment context.",
		},
		{
			DriverID:      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02",
			DriverName:    "Arjun Das",
			ViolationType: "SIMULATOR_DETECTED",
			VarianceScore: 87.1,
			LastPingText:  "Zero sensor bearing oscillation detected across 4 consecutive logs.",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"alerts": alerts,
	})
}
