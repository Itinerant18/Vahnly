package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Public, unauthenticated config endpoints consumed by the rider/driver apps on
// startup. Both are Redis-cached so app traffic never hammers Postgres:
//   - /api/v1/config/flags        → feature flags (cache TTL 60s; apps re-cache 1h)
//   - /api/v1/config/app-version  → min/latest app version (cache TTL 5m)

type publicFlag struct {
	Enabled        bool `json:"enabled"`
	RolloutPercent int  `json:"rollout_percent"`
}

// HandlePublicFlags returns the active feature flags applicable to the caller's
// city + role. GET /api/v1/config/flags?city=KOL&role=RIDER
func (h *GatewayHandler) HandlePublicFlags(w http.ResponseWriter, r *http.Request) {
	city := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("city")))
	if city == "" {
		city = strings.ToUpper(strings.TrimSpace(r.Header.Get("X-Region-Prefix")))
	}
	role := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("role")))
	cacheKey := "public:flags:" + city + ":" + role

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// Cache hit (rule 1 — flags do not hit the DB on every request).
	if h.clusterClient != nil {
		if cached, err := h.clusterClient.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=3600")
			_, _ = w.Write([]byte(cached))
			return
		}
	}

	rows, err := h.dbPool.Query(ctx, `
		SELECT flag_key, is_enabled, COALESCE(rollout_percentage, 100),
		       COALESCE(target_cities, '{}'), COALESCE(target_roles, '{}'), COALESCE(is_kill_switch, false)
		FROM feature_flags
	`)
	flags := map[string]publicFlag{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var key string
			var enabled, kill bool
			var rollout int
			var cities, roles []string
			if rows.Scan(&key, &enabled, &rollout, &cities, &roles, &kill) != nil {
				continue
			}
			// Kill switch forces a flag off regardless of other targeting.
			effective := enabled && !kill
			if effective && len(cities) > 0 && city != "" && !contains(cities, city) {
				effective = false
			}
			if effective && len(roles) > 0 && role != "" && !contains(roles, role) {
				effective = false
			}
			flags[key] = publicFlag{Enabled: effective, RolloutPercent: rollout}
		}
	}

	payload, _ := json.Marshal(map[string]any{"flags": flags, "cache_seconds": 3600})
	if h.clusterClient != nil {
		_ = h.clusterClient.Set(ctx, cacheKey, payload, time.Minute).Err()
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(payload)
}

// HandlePublicAppVersion returns the minimum-supported and latest app version for a
// platform so the app can prompt/force an update. GET /api/v1/config/app-version?platform=ios
func (h *GatewayHandler) HandlePublicAppVersion(w http.ResponseWriter, r *http.Request) {
	platform := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("platform")))
	if platform == "" {
		platform = "android"
	}
	cacheKey := "public:appversion:" + platform

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if h.clusterClient != nil {
		if cached, err := h.clusterClient.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=300")
			_, _ = w.Write([]byte(cached))
			return
		}
	}

	var latest, minSupported, storeURL string
	err := h.dbPool.QueryRow(ctx, `
		SELECT version_string, COALESCE(min_supported_version, ''), COALESCE(store_url, '')
		FROM app_versions
		WHERE platform = $1
		ORDER BY is_latest DESC, created_at DESC
		LIMIT 1
	`, platform).Scan(&latest, &minSupported, &storeURL)
	if err != nil {
		// No version row configured — return a permissive default (never block the app).
		latest, minSupported, storeURL = "", "", ""
	}

	payload, _ := json.Marshal(map[string]any{
		"platform":              platform,
		"latest_version":        latest,
		"min_supported_version": minSupported,
		"store_url":             storeURL,
		"force_update":          minSupported != "",
	})
	if h.clusterClient != nil {
		_ = h.clusterClient.Set(ctx, cacheKey, payload, 5*time.Minute).Err()
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(payload)
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if strings.EqualFold(x, v) {
			return true
		}
	}
	return false
}
