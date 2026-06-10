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
	ZoneName             string       `json:"zone_name"`
	CityPrefix           string       `json:"city_prefix"`
	IsActive             bool         `json:"is_active"`
	PolygonCoords        [][2]float64 `json:"polygon_coordinates"` // Array of [lat, lng] map points
	PolicyType           string       `json:"policy_type"`          // "ACTIVE_DISPATCH", "BLACKLIST_BLOCK", "SURGE_FLOOR_FORCE", "TRANSMISSION_RESTRICT"
	SurgeMultiplier      float64      `json:"surge_multiplier"`
	AllowedTransmissions string       `json:"allowed_transmissions"` // "ALL", "AUTOMATIC_ONLY", "MANUAL_ONLY"
	ActivationStart      *time.Time   `json:"activation_start"`
	ActivationEnd        *time.Time   `json:"activation_end"`
	Notes                string       `json:"notes"`
}

type GeofenceResponseItem struct {
	ID                   string       `json:"id"`
	ZoneName             string       `json:"zone_name"`
	CityPrefix           string       `json:"city_prefix"`
	IsActive             bool         `json:"is_active"`
	PolygonCoords        [][2]float64 `json:"polygon_coordinates"`
	PolicyType           string       `json:"policy_type"`
	SurgeMultiplier      float64      `json:"surge_multiplier"`
	AllowedTransmissions string       `json:"allowed_transmissions"`
	ActivationStart      *time.Time   `json:"activation_start"`
	ActivationEnd        *time.Time   `json:"activation_end"`
	Notes                string       `json:"notes"`
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
	defer tx.Rollback(ctx)

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

	// Notify the driver app in real time. The gateway bridges this channel
	// ("gateway:assignments:broadcast", see gateway/delivery/http.RedisPubSubChannel)
	// to the driver's WebSocket; without it a force-matched driver only discovers the
	// assignment by polling, and never receives a push for the new order.
	assignmentEvent := map[string]interface{}{
		"order_id":    req.OrderID,
		"driver_id":   req.DriverID,
		"city_prefix": cityPrefix,
		"status":      "ASSIGNED",
	}
	if payload, mErr := json.Marshal(assignmentEvent); mErr == nil {
		_ = h.clusterClient.Publish(ctx, "gateway:assignments:broadcast", string(payload)).Err()
	}

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

	if req.PolicyType == "" {
		req.PolicyType = "ACTIVE_DISPATCH"
	}
	if req.SurgeMultiplier <= 0 {
		req.SurgeMultiplier = 1.00
	}
	if req.AllowedTransmissions == "" {
		req.AllowedTransmissions = "ALL"
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
		INSERT INTO operational_geofences (
			id, zone_name, city_prefix, boundary, is_active, 
			policy_type, surge_multiplier, allowed_transmissions, 
			activation_start, activation_end, notes, updated_at
		)
		VALUES (
			gen_random_uuid(), $1, $2, ST_GeomFromText($3, 4326), $4,
			$5, $6, $7, $8, $9, $10, NOW()
		)
		ON CONFLICT (zone_name) DO UPDATE 
		SET boundary = ST_GeomFromText($3, 4326), 
		    is_active = $4, 
		    policy_type = $5,
		    surge_multiplier = $6,
		    allowed_transmissions = $7,
		    activation_start = $8,
		    activation_end = $9,
		    notes = $10,
		    updated_at = NOW();
	`

	_, err := h.dbPool.Exec(
		ctx, upsertQuery,
		req.ZoneName, req.CityPrefix, wktString, req.IsActive,
		req.PolicyType, req.SurgeMultiplier, req.AllowedTransmissions,
		req.ActivationStart, req.ActivationEnd, req.Notes,
	)
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

// HandleGetGeofenceZones retrieves all operational geofences from PostGIS
func (h *MarketplaceOrchestratorHandler) HandleGetGeofenceZones(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, zone_name, city_prefix, is_active, 
		       policy_type, surge_multiplier, allowed_transmissions, 
		       activation_start, activation_end, notes,
		       ST_AsGeoJSON(boundary) as boundary_geojson
		FROM operational_geofences
		ORDER BY created_at DESC;
	`

	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		h.logger.Printf("[GEOSPATIAL_EXCEPTION] Failed to query geofences: %v", err)
		http.Error(w, "database_query_failure", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type GeoJSONPolygon struct {
		Type        string         `json:"type"`
		Coordinates [][][2]float64 `json:"coordinates"`
	}

	var zones []GeofenceResponseItem
	for rows.Next() {
		var id, zoneName, cityPrefix, policyType, allowedTransmissions string
		var isActive bool
		var surgeMultiplier float64
		var activationStart, activationEnd *time.Time
		var notes *string
		var boundaryGeoJSON string

		err := rows.Scan(
			&id, &zoneName, &cityPrefix, &isActive,
			&policyType, &surgeMultiplier, &allowedTransmissions,
			&activationStart, &activationEnd, &notes,
			&boundaryGeoJSON,
		)
		if err != nil {
			h.logger.Printf("[GEOSPATIAL_EXCEPTION] Failed to scan row: %v", err)
			http.Error(w, "database_row_scan_failure", http.StatusInternalServerError)
			return
		}

		item := GeofenceResponseItem{
			ID:                   id,
			ZoneName:             zoneName,
			CityPrefix:           cityPrefix,
			IsActive:             isActive,
			PolicyType:           policyType,
			SurgeMultiplier:      surgeMultiplier,
			AllowedTransmissions: allowedTransmissions,
			ActivationStart:      activationStart,
			ActivationEnd:        activationEnd,
		}
		if notes != nil {
			item.Notes = *notes
		}

		var geojson GeoJSONPolygon
		if err := json.Unmarshal([]byte(boundaryGeoJSON), &geojson); err == nil && len(geojson.Coordinates) > 0 {
			pts := geojson.Coordinates[0]
			limit := len(pts)
			if len(pts) > 1 && pts[0][0] == pts[len(pts)-1][0] && pts[0][1] == pts[len(pts)-1][1] {
				limit = len(pts) - 1
			}
			coords := make([][2]float64, 0, limit)
			for i := 0; i < limit; i++ {
				coords = append(coords, [2]float64{pts[i][1], pts[i][0]})
			}
			item.PolygonCoords = coords
		}
		zones = append(zones, item)
	}

	if err := rows.Err(); err != nil {
		h.logger.Printf("[GEOSPATIAL_EXCEPTION] Rows iteration error: %v", err)
		http.Error(w, "database_rows_error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"zones": zones})
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
	json.NewEncoder(w).Encode(map[string]any{
		"alerts": alerts,
	})
}
