package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// SurgeHandler backs the admin manual-surge zone tooling, per-city auto-surge config,
// and the rolling surge timeline.
type SurgeHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	logger      *log.Logger
}

func NewSurgeHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, logger *log.Logger) *SurgeHandler {
	return &SurgeHandler{dbPool: dbPool, redisClient: redisClient, logger: logger}
}

func (h *SurgeHandler) audit(ctx context.Context, email, action, entityID, details, ip string) {
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address, entity_type, entity_id)
		VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, $3, $4, 'SURGE_ZONE', $5)
	`, email, action, details, ip, entityID)
}

type manualZone struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	CityPrefix string          `json:"city_prefix"`
	CenterLat  float64         `json:"center_lat"`
	CenterLng  float64         `json:"center_lng"`
	RadiusM    int             `json:"radius_m"`
	Polygon    json.RawMessage `json:"polygon,omitempty"` // [[lat,lng],...] when drawn as a polygon
	Multiplier float64         `json:"multiplier"`
	Reason     string          `json:"reason"`
	CreatedBy  string          `json:"created_by"`
	ExpiresAt  time.Time       `json:"expires_at"`
	CreatedAt  time.Time       `json:"created_at"`
}

// POST /api/v1/admin/surge/manual
func (h *SurgeHandler) HandleCreateManualZone(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name            string          `json:"name"`
		CityPrefix      string          `json:"city_prefix"`
		CenterLat       float64         `json:"center_lat"`
		CenterLng       float64         `json:"center_lng"`
		RadiusM         int             `json:"radius_m"`
		Polygon         json.RawMessage `json:"polygon"` // optional [[lat,lng],...]
		Multiplier      float64         `json:"multiplier"`
		DurationMinutes int             `json:"duration_minutes"`
		Reason          string          `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.CityPrefix == "" {
		http.Error(w, "name_and_city_required", http.StatusBadRequest)
		return
	}
	if req.Multiplier < 1.1 || req.Multiplier > 5.0 {
		http.Error(w, "multiplier_out_of_range_1.1_to_5.0", http.StatusBadRequest)
		return
	}
	if req.DurationMinutes <= 0 {
		http.Error(w, "duration_required", http.StatusBadRequest)
		return
	}
	if req.RadiusM <= 0 {
		req.RadiusM = 1000
	}
	expiresAt := time.Now().Add(time.Duration(req.DurationMinutes) * time.Minute)
	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	// polygon is stored as JSONB; nil when the zone is a circle.
	var polygonArg any
	if len(req.Polygon) > 0 && string(req.Polygon) != "null" {
		polygonArg = string(req.Polygon)
	}
	var id string
	err := h.dbPool.QueryRow(ctx, `
		INSERT INTO manual_surge_zones (name, city_prefix, center_lat, center_lng, radius_m, polygon, multiplier, reason, created_by, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING id::text
	`, req.Name, req.CityPrefix, req.CenterLat, req.CenterLng, req.RadiusM, polygonArg, req.Multiplier, req.Reason, adminEmail, expiresAt).Scan(&id)
	if err != nil {
		http.Error(w, "zone_insert_failed", http.StatusInternalServerError)
		return
	}
	h.audit(ctx, adminEmail, "SURGE_ZONE_CREATED", id, req.Name+" @ "+strconv.FormatFloat(req.Multiplier, 'f', 1, 64)+"x", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(manualZone{
		ID: id, Name: req.Name, CityPrefix: req.CityPrefix, CenterLat: req.CenterLat, CenterLng: req.CenterLng,
		RadiusM: req.RadiusM, Polygon: req.Polygon, Multiplier: req.Multiplier, Reason: req.Reason, CreatedBy: adminEmail, ExpiresAt: expiresAt,
	})
}

// GET /api/v1/admin/surge/manual?city=KOL — active, non-expired zones.
func (h *SurgeHandler) HandleListManualZones(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, name, city_prefix, center_lat, center_lng, radius_m, polygon, multiplier,
		       COALESCE(reason, ''), COALESCE(created_by, ''), expires_at, created_at
		FROM manual_surge_zones
		WHERE is_active = TRUE AND expires_at > NOW() AND ($1 = '' OR city_prefix = $1)
		ORDER BY created_at DESC
	`, city)
	if err != nil {
		http.Error(w, "zones_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	zones := make([]manualZone, 0)
	for rows.Next() {
		var z manualZone
		var polygon *string
		if rows.Scan(&z.ID, &z.Name, &z.CityPrefix, &z.CenterLat, &z.CenterLng, &z.RadiusM, &polygon, &z.Multiplier, &z.Reason, &z.CreatedBy, &z.ExpiresAt, &z.CreatedAt) == nil {
			if polygon != nil {
				z.Polygon = json.RawMessage(*polygon)
			}
			zones = append(zones, z)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"zones": zones})
}

// DELETE /api/v1/admin/surge/manual/{id} — deactivate a zone early.
func (h *SurgeHandler) HandleDeleteManualZone(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_zone_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	res, err := h.dbPool.Exec(ctx, "UPDATE manual_surge_zones SET is_active = FALSE WHERE id = $1::uuid", id)
	if err != nil {
		http.Error(w, "zone_delete_failed", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "zone_not_found", http.StatusNotFound)
		return
	}
	h.audit(ctx, r.Header.Get("X-Admin-Email"), "SURGE_ZONE_DEACTIVATED", id, "Manual surge zone deactivated", getClientIP(r))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "DEACTIVATED"})
}

// GET /api/v1/admin/surge/history?city=KOL — avg applied surge per hour over last 24h.
func (h *SurgeHandler) HandleGetSurgeHistory(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	rows, err := h.dbPool.Query(ctx, `
		SELECT to_char(date_trunc('hour', created_at), 'YYYY-MM-DD"T"HH24:00'),
		       COALESCE(AVG(surge_multiplier), 1.0)::float8,
		       COUNT(*)
		FROM orders
		WHERE created_at > NOW() - INTERVAL '24 hours' AND ($1 = '' OR city_prefix = $1)
		GROUP BY 1 ORDER BY 1
	`, city)
	if err != nil {
		http.Error(w, "history_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type bucket struct {
		Hour     string  `json:"hour"`
		AvgSurge float64 `json:"avg_surge"`
		Samples  int     `json:"samples"`
	}
	out := make([]bucket, 0)
	for rows.Next() {
		var b bucket
		if rows.Scan(&b.Hour, &b.AvgSurge, &b.Samples) == nil {
			out = append(out, b)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"history": out})
}

func surgeConfigKey(city string) string { return "surge:config:" + strings.ToUpper(city) }

// GET /api/v1/admin/surge/config/{city} — per-city auto-surge thresholds/cap/cooldown.
// Falls back to the global pricing:surge:rules defaults when no city override exists.
func (h *SurgeHandler) HandleGetSurgeConfig(w http.ResponseWriter, r *http.Request) {
	city := strings.ToUpper(r.PathValue("city"))
	if city == "" {
		http.Error(w, "missing_city", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var rules SurgeRules
	loaded := false
	if h.redisClient != nil {
		if val, err := h.redisClient.Get(ctx, surgeConfigKey(city)).Result(); err == nil && val != "" {
			loaded = json.Unmarshal([]byte(val), &rules) == nil
		}
	}
	if !loaded {
		rules = SurgeRules{
			AutoRules: []AutoSurgeRule{
				{MinDemandSupplyRatio: 2.0, Multiplier: 1.5},
				{MinDemandSupplyRatio: 3.0, Multiplier: 2.0},
				{MinDemandSupplyRatio: 5.0, Multiplier: 2.5},
			},
			SurgeCap:     3.0,
			CooldownSecs: 300,
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"city": city, "config": rules})
}

// PUT /api/v1/admin/surge/config/{city}
func (h *SurgeHandler) HandlePutSurgeConfig(w http.ResponseWriter, r *http.Request) {
	city := strings.ToUpper(r.PathValue("city"))
	if city == "" {
		http.Error(w, "missing_city", http.StatusBadRequest)
		return
	}
	var req SurgeRules
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_json_body", http.StatusBadRequest)
		return
	}
	if req.SurgeCap < 1.0 || req.SurgeCap > 5.0 {
		http.Error(w, "surge_cap_out_of_range_1.0_to_5.0", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	if h.redisClient != nil {
		payload, _ := json.Marshal(req)
		if err := h.redisClient.Set(ctx, surgeConfigKey(city), payload, 0).Err(); err != nil {
			http.Error(w, "config_write_failed", http.StatusInternalServerError)
			return
		}
	}
	adminEmail := r.Header.Get("X-Admin-Email")
	if adminEmail == "" {
		adminEmail = "admin@platform.com"
	}
	h.audit(ctx, adminEmail, "SURGE_CONFIG_UPDATED", city,
		"Updated surge config for "+city+" (cap "+strconv.FormatFloat(req.SurgeCap, 'f', 1, 64)+"x)", getClientIP(r))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "SUCCESS", "city": city})
}
