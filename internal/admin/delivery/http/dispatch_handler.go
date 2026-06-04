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

type DispatchHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
}

func NewDispatchHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *DispatchHandler {
	return &DispatchHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
		logger:      logger,
	}
}

type CityConfig struct {
	OperatingHoursStart string   `json:"operating_hours_start"` // e.g. "00:00"
	OperatingHoursEnd   string   `json:"operating_hours_end"`   // e.g. "23:59"
	SupportedTripTypes  []string `json:"supported_trip_types"`  // e.g. ["one-way", "outstation"]
	SupportedCarTypes   []string `json:"supported_car_types"`   // e.g. ["Hatchback", "Sedan"]
}

type CityResponseItem struct {
	CityPrefix          string       `json:"city_prefix"`
	CityName            string       `json:"city_name"`
	Timezone            string       `json:"timezone"`
	IsActive            bool         `json:"is_active"`
	PolygonCoords       [][2]float64 `json:"polygon_coordinates"` // [lat, lng] polygon points
	OperatingHoursStart string       `json:"operating_hours_start"`
	OperatingHoursEnd   string       `json:"operating_hours_end"`
	SupportedTripTypes  []string     `json:"supported_trip_types"`
	SupportedCarTypes   []string     `json:"supported_car_types"`
}

type CityPayload struct {
	CityPrefix          string       `json:"city_prefix"`
	CityName            string       `json:"city_name"`
	Timezone            string       `json:"timezone"`
	IsActive            bool         `json:"is_active"`
	PolygonCoords       [][2]float64 `json:"polygon_coordinates"`
	OperatingHoursStart string       `json:"operating_hours_start"`
	OperatingHoursEnd   string       `json:"operating_hours_end"`
	SupportedTripTypes  []string     `json:"supported_trip_types"`
	SupportedCarTypes   []string     `json:"supported_car_types"`
}

type DispatchRules struct {
	MatchingRadiusMap              map[string]float64 `json:"matching_radius_map"` // trip_type -> km
	MaxWaitTimeSeconds             int                `json:"max_wait_time_seconds"`
	MaxRetries                     int                `json:"max_retries"`
	MinDriverRating                float64            `json:"min_driver_rating"`
	MinDriverAcceptanceRate        float64            `json:"min_driver_acceptance_rate"`
	TransmissionCapability         string             `json:"transmission_capability"` // "ALL", "MATCH"
	PriorityOrder                  string             `json:"priority_order"` // "NEAREST", "HIGHEST_RATED", "ROUND_ROBIN"
	OutstationPreAssignmentMinutes int                `json:"outstation_pre_assignment_minutes"`
	OutstationAdvancePaymentPct    int                `json:"outstation_advance_payment_pct"`
}

func (h *DispatchHandler) HandleGetCities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT city_prefix, city_name, timezone, is_active, ST_AsGeoJSON(geofence) as geofence_geojson
		FROM regional_cities
		ORDER BY city_name ASC;
	`

	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		h.logger.Printf("[DISPATCH_ERROR] Failed to query regional cities: %v", err)
		http.Error(w, "database_query_failure", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type GeoJSONMultiPolygon struct {
		Type        string           `json:"type"`
		Coordinates [][][][2]float64 `json:"coordinates"` // MultiPolygon is 4D
	}

	type GeoJSONPolygon struct {
		Type        string         `json:"type"`
		Coordinates [][][2]float64 `json:"coordinates"` // Polygon is 3D
	}

	var cities []CityResponseItem

	for rows.Next() {
		var cityPrefix, cityName, timezone string
		var isActive bool
		var geofenceGeoJSON *string

		if err := rows.Scan(&cityPrefix, &cityName, &timezone, &isActive, &geofenceGeoJSON); err != nil {
			h.logger.Printf("[DISPATCH_ERROR] Failed to scan city row: %v", err)
			continue
		}

		item := CityResponseItem{
			CityPrefix:         cityPrefix,
			CityName:           cityName,
			Timezone:           timezone,
			IsActive:           isActive,
			SupportedTripTypes: []string{},
			SupportedCarTypes:  []string{},
		}

		// Parse geofence coordinates
		if geofenceGeoJSON != nil && *geofenceGeoJSON != "" {
			// PostGIS geofence is MultiPolygon, but some might be stored as Polygon. Let's handle both.
			if strings.Contains(*geofenceGeoJSON, "MultiPolygon") {
				var mpjs GeoJSONMultiPolygon
				if err := json.Unmarshal([]byte(*geofenceGeoJSON), &mpjs); err == nil && len(mpjs.Coordinates) > 0 {
					// Extract the first polygon coordinates
					pts := mpjs.Coordinates[0][0]
					coords := make([][2]float64, 0, len(pts))
					for _, p := range pts {
						coords = append(coords, [2]float64{p[1], p[0]}) // Lat, Lon
					}
					item.PolygonCoords = coords
				}
			} else {
				var pjs GeoJSONPolygon
				if err := json.Unmarshal([]byte(*geofenceGeoJSON), &pjs); err == nil && len(pjs.Coordinates) > 0 {
					pts := pjs.Coordinates[0]
					coords := make([][2]float64, 0, len(pts))
					for _, p := range pts {
						coords = append(coords, [2]float64{p[1], p[0]})
					}
					item.PolygonCoords = coords
				}
			}
		}

		// Fetch Redis config overrides
		configKey := "dispatch:city:config:" + cityPrefix
		configVal, err := h.redisClient.Get(ctx, configKey).Result()
		if err == nil && configVal != "" {
			var config CityConfig
			if err := json.Unmarshal([]byte(configVal), &config); err == nil {
				item.OperatingHoursStart = config.OperatingHoursStart
				item.OperatingHoursEnd = config.OperatingHoursEnd
				if config.SupportedTripTypes != nil {
					item.SupportedTripTypes = config.SupportedTripTypes
				}
				if config.SupportedCarTypes != nil {
					item.SupportedCarTypes = config.SupportedCarTypes
				}
			}
		}

		// Fallback defaults
		if item.OperatingHoursStart == "" {
			item.OperatingHoursStart = "00:00"
			item.OperatingHoursEnd = "23:59"
		}
		if len(item.SupportedTripTypes) == 0 {
			item.SupportedTripTypes = []string{"in-city round", "one-way", "mini-outstation", "outstation"}
		}
		if len(item.SupportedCarTypes) == 0 {
			item.SupportedCarTypes = []string{"Hatchback", "Sedan", "SUV", "Premium"}
		}

		cities = append(cities, item)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cities)
}

func (h *DispatchHandler) HandlePostCity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CityPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_body", http.StatusBadRequest)
		return
	}

	if req.CityPrefix == "" || req.CityName == "" {
		http.Error(w, "missing_city_prefix_or_name", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Convert coordinates to PostGIS MultiPolygon WKT
	var wktString string
	if len(req.PolygonCoords) >= 3 {
		wktString = "MULTIPOLYGON((("
		for i, coord := range req.PolygonCoords {
			if i > 0 {
				wktString += ","
			}
			wktString += fmt.Sprintf("%f %f", coord[1], coord[0]) // Lon, Lat
		}
		// Seal polygon
		wktString += fmt.Sprintf(",%f %f", req.PolygonCoords[0][1], req.PolygonCoords[0][0])
		wktString += ")))"
	}

	upsertQuery := `
		INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active, geofence)
		VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326)::geography)
		ON CONFLICT (city_prefix) DO UPDATE 
		SET city_name = $2,
		    timezone = $3,
		    is_active = $4,
		    geofence = CASE WHEN $5 <> '' THEN ST_GeomFromText($5, 4326)::geography ELSE regional_cities.geofence END;
	`

	wktArg := wktString
	_, err := h.dbPool.Exec(ctx, upsertQuery, req.CityPrefix, req.CityName, req.Timezone, req.IsActive, wktArg)
	if err != nil {
		h.logger.Printf("[DISPATCH_ERROR] Upsert regional city failed: %v", err)
		http.Error(w, "database_upsert_failed", http.StatusInternalServerError)
		return
	}

	// Save Redis config metadata
	configKey := "dispatch:city:config:" + req.CityPrefix
	config := CityConfig{
		OperatingHoursStart: req.OperatingHoursStart,
		OperatingHoursEnd:   req.OperatingHoursEnd,
		SupportedTripTypes:  req.SupportedTripTypes,
		SupportedCarTypes:   req.SupportedCarTypes,
	}
	configBytes, err := json.Marshal(config)
	if err == nil {
		_ = h.redisClient.Set(ctx, configKey, configBytes, 0).Err()
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "DISPATCH_CITY_UPSERTED", fmt.Sprintf("Admin upserted city hub %s (%s)", req.CityName, req.CityPrefix), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *DispatchHandler) HandleGetDispatchRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	city := r.PathValue("city")
	if city == "" {
		http.Error(w, "missing_city_parameter", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rulesKey := "dispatch:city:rules:" + city
	val, err := h.redisClient.Get(ctx, rulesKey).Result()

	var rules DispatchRules
	if err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &rules)
	}

	// Fallback standard rules
	if rules.MatchingRadiusMap == nil {
		rules.MatchingRadiusMap = map[string]float64{
			"in-city round":   5.0,
			"one-way":         5.0,
			"mini-outstation": 7.0,
			"outstation":      10.0,
		}
	}
	if rules.MaxWaitTimeSeconds == 0 {
		rules.MaxWaitTimeSeconds = 300
	}
	if rules.MaxRetries == 0 {
		rules.MaxRetries = 3
	}
	if rules.MinDriverRating == 0 {
		rules.MinDriverRating = 4.3
	}
	if rules.TransmissionCapability == "" {
		rules.TransmissionCapability = "ALL"
	}
	if rules.PriorityOrder == "" {
		rules.PriorityOrder = "NEAREST"
	}
	if rules.OutstationPreAssignmentMinutes == 0 {
		rules.OutstationPreAssignmentMinutes = 120
	}
	if rules.OutstationAdvancePaymentPct == 0 {
		rules.OutstationAdvancePaymentPct = 20
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rules)
}

func (h *DispatchHandler) HandlePostDispatchRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	city := r.PathValue("city")
	if city == "" {
		http.Error(w, "missing_city_parameter", http.StatusBadRequest)
		return
	}

	var req DispatchRules
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rulesKey := "dispatch:city:rules:" + city
	rulesBytes, err := json.Marshal(req)
	if err != nil {
		http.Error(w, "failed_to_serialize_rules", http.StatusInternalServerError)
		return
	}

	err = h.redisClient.Set(ctx, rulesKey, rulesBytes, 0).Err()
	if err != nil {
		http.Error(w, "redis_write_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", adminEmail, "DISPATCH_RULES_UPDATED", fmt.Sprintf("Updated match dispatch rules configuration for city prefix %s", city), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

func (h *DispatchHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string) {
	query := `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address)
		VALUES ($1, $2, $3, $4, $5)
	`
	var idVal interface{} = adminID
	if adminID == "" {
		idVal = "00000000-0000-0000-0000-000000000000"
	}
	_, _ = h.dbPool.Exec(ctx, query, idVal, email, action, details, ip)
}
