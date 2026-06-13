package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// CitiesHandler manages the DB-driven city/region registry (regional_cities). The
// list is cached in Redis (cities:list, 5m TTL) and invalidated on any change.
type CitiesHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
}

func NewCitiesHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *CitiesHandler {
	return &CitiesHandler{dbPool: dbPool, redisClient: redisClient, logger: logger}
}

const citiesCacheKey = "cities:list"

type city struct {
	Code                string   `json:"code"`
	Name                string   `json:"name"`
	Timezone            string   `json:"timezone"`
	Enabled             bool     `json:"enabled"`
	OperatingHoursStart *string  `json:"operating_hours_start"`
	OperatingHoursEnd   *string  `json:"operating_hours_end"`
	SupportedTripTypes  []string `json:"supported_trip_types"`
}

// HandleListCities returns the city registry. GET /api/v1/admin/cities
func (h *CitiesHandler) HandleListCities(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	if h.redisClient != nil {
		if cached, err := h.redisClient.Get(ctx, citiesCacheKey).Result(); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(cached))
			return
		}
	}

	rows, err := h.dbPool.Query(ctx, `
		SELECT city_prefix, city_name, COALESCE(timezone, 'Asia/Kolkata'), is_active,
		       to_char(operating_hours_start, 'HH24:MI'), to_char(operating_hours_end, 'HH24:MI'),
		       COALESCE(supported_trip_types, '{}')
		FROM regional_cities ORDER BY city_prefix
	`)
	if err != nil {
		http.Error(w, "cities_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cities := make([]city, 0)
	for rows.Next() {
		var c city
		if rows.Scan(&c.Code, &c.Name, &c.Timezone, &c.Enabled, &c.OperatingHoursStart, &c.OperatingHoursEnd, &c.SupportedTripTypes) == nil {
			cities = append(cities, c)
		}
	}

	payload, _ := json.Marshal(map[string]any{"cities": cities})
	if h.redisClient != nil {
		_ = h.redisClient.Set(ctx, citiesCacheKey, payload, 5*time.Minute).Err()
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(payload)
}

// HandleCreateCity adds or updates a city, then invalidates the cache.
// POST /api/v1/admin/cities
func (h *CitiesHandler) HandleCreateCity(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code                string   `json:"code"`
		Name                string   `json:"name"`
		Timezone            string   `json:"timezone"`
		Enabled             *bool    `json:"enabled"`
		OperatingHoursStart string   `json:"operating_hours_start"`
		OperatingHoursEnd   string   `json:"operating_hours_end"`
		SupportedTripTypes  []string `json:"supported_trip_types"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Code = strings.ToUpper(strings.TrimSpace(req.Code))
	if req.Code == "" || strings.TrimSpace(req.Name) == "" {
		http.Error(w, "code_and_name_required", http.StatusBadRequest)
		return
	}
	if req.Timezone == "" {
		req.Timezone = "Asia/Kolkata"
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.SupportedTripTypes == nil {
		req.SupportedTripTypes = []string{}
	}
	var startArg, endArg any
	if req.OperatingHoursStart != "" {
		startArg = req.OperatingHoursStart
	}
	if req.OperatingHoursEnd != "" {
		endArg = req.OperatingHoursEnd
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	_, err := h.dbPool.Exec(ctx, `
		INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active, operating_hours_start, operating_hours_end, supported_trip_types)
		VALUES ($1, $2, $3, $4, $5::time, $6::time, $7)
		ON CONFLICT (city_prefix) DO UPDATE
		SET city_name = EXCLUDED.city_name, timezone = EXCLUDED.timezone, is_active = EXCLUDED.is_active,
		    operating_hours_start = EXCLUDED.operating_hours_start, operating_hours_end = EXCLUDED.operating_hours_end,
		    supported_trip_types = EXCLUDED.supported_trip_types
	`, req.Code, req.Name, req.Timezone, enabled, startArg, endArg, req.SupportedTripTypes)
	if err != nil {
		h.logger.Printf("[CITIES] upsert failed: %v", err)
		http.Error(w, "city_upsert_failed", http.StatusInternalServerError)
		return
	}

	// Invalidate the cached list so the next read reflects the change.
	if h.redisClient != nil {
		_ = h.redisClient.Del(ctx, citiesCacheKey).Err()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "SUCCESS", "code": req.Code})
}
