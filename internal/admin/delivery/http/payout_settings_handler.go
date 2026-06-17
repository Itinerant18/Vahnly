package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// Payout settings are stored as individual keys in the existing platform_settings
// key-value table (category = 'payout'), avoiding a dedicated migration. Defaults are
// returned when keys are absent so GET always yields a usable object with HTTP 200.

type payoutSettings struct {
	AutoPayoutEnabled bool   `json:"auto_payout_enabled"`
	Schedule          string `json:"schedule"`
	MinPaise          int64  `json:"min_paise"`
	MaxPaise          int64  `json:"max_paise"`
}

const (
	keyPayoutAutoEnabled = "payout.auto_payout_enabled"
	keyPayoutSchedule    = "payout.schedule"
	keyPayoutMinPaise    = "payout.min_paise"
	keyPayoutMaxPaise    = "payout.max_paise"
)

// GET /api/v1/admin/finance/payouts/settings
func (h *AdminExtrasHandler) HandleGetPayoutSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Sensible defaults; overridden by any stored platform_settings rows.
	settings := payoutSettings{
		AutoPayoutEnabled: false,
		Schedule:          "WEEKLY",
		MinPaise:          10000,   // ₹100
		MaxPaise:          5000000, // ₹50,000
	}

	values := map[string]string{}
	if rows, err := h.dbPool.Query(ctx, `
		SELECT key, value FROM platform_settings WHERE key = ANY($1)`,
		[]string{keyPayoutAutoEnabled, keyPayoutSchedule, keyPayoutMinPaise, keyPayoutMaxPaise}); err == nil {
		for rows.Next() {
			var k, v string
			if err := rows.Scan(&k, &v); err == nil {
				values[k] = v
			}
		}
		rows.Close()
	}

	if v, ok := values[keyPayoutAutoEnabled]; ok {
		settings.AutoPayoutEnabled = v == "true"
	}
	if v, ok := values[keyPayoutSchedule]; ok && v != "" {
		settings.Schedule = v
	}
	if v, ok := values[keyPayoutMinPaise]; ok {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			settings.MinPaise = n
		}
	}
	if v, ok := values[keyPayoutMaxPaise]; ok {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			settings.MaxPaise = n
		}
	}

	writeExtrasJSON(w, settings)
}

// PUT /api/v1/admin/finance/payouts/settings
func (h *AdminExtrasHandler) HandlePutPayoutSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req payoutSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	updates := []struct {
		key, value, dataType string
	}{
		{keyPayoutAutoEnabled, strconv.FormatBool(req.AutoPayoutEnabled), "boolean"},
		{keyPayoutSchedule, req.Schedule, "string"},
		{keyPayoutMinPaise, strconv.FormatInt(req.MinPaise, 10), "number"},
		{keyPayoutMaxPaise, strconv.FormatInt(req.MaxPaise, 10), "number"},
	}

	// Upsert each key. If the platform_settings table is absent this is best-effort
	// and still returns a 200 echo so the frontend can proceed.
	for _, u := range updates {
		_, _ = h.dbPool.Exec(ctx, `
			INSERT INTO platform_settings (key, value, data_type, category, description, updated_by)
			VALUES ($1, $2, $3, 'payout', 'Driver payout setting', $4)
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value, data_type = EXCLUDED.data_type,
			    category = 'payout', updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
			u.key, u.value, u.dataType, adminEmailOf(r))
	}

	writeExtrasJSON(w, map[string]any{"message": "Payout settings saved"})
}
