package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
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
	PolicyType           string       `json:"policy_type"`         // "ACTIVE_DISPATCH", "BLACKLIST_BLOCK", "SURGE_FLOOR_FORCE", "TRANSMISSION_RESTRICT"
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

	// Lock the driver row and verify they are actually free. The FOR UPDATE serializes
	// concurrent force-matches (and the live matcher), and rejecting a non-available
	// driver prevents binding the same driver to two orders.
	var driverState string
	err = tx.QueryRow(ctx,
		"SELECT current_state::text FROM drivers WHERE id = $1::uuid FOR UPDATE",
		req.DriverID).Scan(&driverState)
	if err != nil {
		http.Error(w, "driver_not_found", http.StatusNotFound)
		return
	}
	if driverState != "ONLINE_AVAILABLE" {
		http.Error(w, "driver_not_available_for_force_match", http.StatusConflict)
		return
	}

	// Cancel any other order currently held as a pending offer for this driver so the
	// force-match cannot leave them double-assigned. Released orders return to the
	// matchable pool as CREATED.
	_, err = tx.Exec(ctx, `
		UPDATE orders
		SET status = 'CREATED'::order_status_enum,
		    assigned_driver_id = NULL,
		    assigned_at = NULL
		WHERE assigned_driver_id = $1::uuid
		  AND status = 'ASSIGNED'::order_status_enum
		  AND id <> $2::uuid`,
		req.DriverID, req.OrderID)
	if err != nil {
		http.Error(w, "existing_offer_cancel_failed", http.StatusInternalServerError)
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

	// Mark this as an admin force-match so the offer-timeout janitor does not treat the
	// ASSIGNED order as an unaccepted 15s offer and roll it back to CREATED.
	_ = h.clusterClient.Set(ctx, fmt.Sprintf("offer:forcematch:%s", req.OrderID), "1", 6*time.Hour).Err()

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

	// Phase 10: an operations force-match is not a normal offer, so tell the driver
	// explicitly. Gather rider + car context for a human-readable push, deliver a typed
	// `driver.force.assigned` WS message, and queue an FCM backup so an offline driver
	// still learns of the assignment.
	var riderName, carMake, carModel, pickupAddr, riderID, driverName string
	_ = h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(r.name, ''),
		       COALESCE(g.make, o.one_time_car_make, ''),
		       COALESCE(g.model, o.one_time_car_model, ''),
		       'Pickup (' || ROUND(ST_Y(o.pickup_location::geometry)::numeric, 4) || ', ' ||
		                     ROUND(ST_X(o.pickup_location::geometry)::numeric, 4) || ')',
		       COALESCE(o.rider_id::text, ''),
		       COALESCE(d.name, '')
		FROM orders o
		LEFT JOIN riders r       ON r.id = o.rider_id
		LEFT JOIN rider_garage g ON g.id = o.garage_car_id
		LEFT JOIN drivers d      ON d.id = o.assigned_driver_id
		WHERE o.id = $1::uuid`, req.OrderID).Scan(&riderName, &carMake, &carModel, &pickupAddr, &riderID, &driverName)

	firstName := riderName
	if firstName == "" {
		firstName = "a rider"
	} else if i := strings.IndexByte(firstName, ' '); i > 0 {
		firstName = firstName[:i]
	}
	carContext := strings.TrimSpace(carMake + " " + carModel)
	if carContext == "" {
		carContext = "their car"
	}
	forceMsg := "You've been assigned a trip by operations"

	forceAssigned := map[string]interface{}{
		"type":           "driver.force.assigned",
		"driver_id":      req.DriverID,
		"order_id":       req.OrderID,
		"pickup_address": pickupAddr,
		"rider_name":     firstName,
		"car_context":    carContext,
		"message":        forceMsg,
	}
	if payload, mErr := json.Marshal(forceAssigned); mErr == nil {
		_ = h.clusterClient.Publish(ctx, "gateway:assignments:broadcast", string(payload)).Err()
	}

	// In-app notification + FCM outbox backup.
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO driver_notifications (driver_id, category, title, body)
		VALUES ($1::uuid, 'TRIPS', $2, $3)`,
		req.DriverID, "New trip assigned", forceMsg)
	fcmPayload := fmt.Sprintf(`{"type":"driver.force.assigned","order_id":"%s"}`, req.OrderID)
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO notification_outbox (user_id, title, body, payload)
		VALUES ($1::uuid, $2, $3, $4::jsonb)`,
		req.DriverID, "New trip assigned", forceMsg, fcmPayload)

	// Notify the RIDER over their live-trip WS (FLOW 6 rider side). Mirrors the normal
	// dispatch path's rider.order.assigned; published as an Envelope on the rider backplane.
	if riderID != "" {
		vehicleContext := strings.TrimSpace("Driving your " + carContext)
		data, _ := json.Marshal(map[string]interface{}{
			"order_id":        req.OrderID,
			"driver_id":       req.DriverID,
			"driver_name":     driverName,
			"driver_photo":    "",
			"eta_minutes":     0,
			"vehicle_context": vehicleContext,
			"message":         "Driver assigned by operations",
		})
		envelope, _ := json.Marshal(map[string]interface{}{
			"rider_id": riderID,
			"type":     "rider.order.assigned",
			"data":     json.RawMessage(data),
		})
		_ = h.clusterClient.Publish(ctx, "gateway:rider:broadcast", string(envelope)).Err()
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"FORCE_ALLOCATION_COMMITTED_SUCCESSFULLY"}`))
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
	w.Write([]byte(`{"status":"GEOFENCE_GEOMETRY_UPSERTED_SUCCESSFULLY"}`))
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
	w.Write([]byte(`{"status":"COMPLIANCE_FRAUD_LOCKOUT_COMMITTED"}`))
}

// HandleGetFraudAnomalies exposes active/suspicious telemetry spoofing exceptions
func (h *MarketplaceOrchestratorHandler) HandleGetFraudAnomalies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Real open driver fraud events. Empty until a detector writes fraud_events — an
	// honest empty list, not a fabricated demo dataset.
	alerts := []FraudAnomaly{}
	rows, err := h.dbPool.Query(ctx, `
		SELECT f.entity_id, COALESCE(d.name, ''), f.fraud_type, f.score::float,
		       COALESCE(f.evidence->>'detail', f.evidence::text)
		FROM fraud_events f
		LEFT JOIN drivers d ON d.id::text = f.entity_id
		WHERE f.entity_type = 'DRIVER' AND f.status = 'OPEN'
		ORDER BY f.created_at DESC LIMIT 100`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var a FraudAnomaly
			if rows.Scan(&a.DriverID, &a.DriverName, &a.ViolationType, &a.VarianceScore, &a.LastPingText) == nil {
				alerts = append(alerts, a)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"alerts": alerts,
	})
}
