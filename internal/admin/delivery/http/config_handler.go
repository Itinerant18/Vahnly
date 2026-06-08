package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ConfigHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewConfigHandler(dbPool *pgxpool.Pool, logger *log.Logger) *ConfigHandler {
	return &ConfigHandler{dbPool: dbPool, logger: logger}
}

// ── 20.1 Global Settings ─────────────────────────────────────────────────────

type PlatformSetting struct {
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	DataType    string    `json:"data_type"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	UpdatedBy   string    `json:"updated_by"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (h *ConfigHandler) HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	category := r.URL.Query().Get("category")
	query := `SELECT key, value, data_type, category, description, updated_by, updated_at FROM platform_settings WHERE 1=1`
	var args []interface{}
	if category != "" {
		query += " AND category = $1"
		args = append(args, category)
	}
	query += " ORDER BY category, key"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	settings := make([]PlatformSetting, 0)
	for rows.Next() {
		var s PlatformSetting
		if err := rows.Scan(&s.Key, &s.Value, &s.DataType, &s.Category, &s.Description, &s.UpdatedBy, &s.UpdatedAt); err == nil {
			settings = append(settings, s)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"settings": settings})
}

func (h *ConfigHandler) HandleUpsertSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Settings []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "tx_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	for _, s := range req.Settings {
		_, _ = tx.Exec(ctx,
			`UPDATE platform_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = $3`,
			s.Value, adminEmail, s.Key)
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "tx_commit_failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

// ── 20.2 Feature Flags ───────────────────────────────────────────────────────

type FeatureFlag struct {
	ID                int       `json:"id"`
	FlagKey           string    `json:"flag_key"`
	Name              string    `json:"name"`
	Description       string    `json:"description"`
	IsEnabled         bool      `json:"is_enabled"`
	RolloutPercentage int       `json:"rollout_percentage"`
	TargetCities      []string  `json:"target_cities"`
	TargetRoles       []string  `json:"target_roles"`
	IsKillSwitch      bool      `json:"is_kill_switch"`
	CreatedBy         string    `json:"created_by"`
	UpdatedBy         string    `json:"updated_by"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (h *ConfigHandler) HandleGetFlags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx,
		`SELECT id, flag_key, name, description, is_enabled, rollout_percentage,
		        target_cities, target_roles, is_kill_switch, created_by, updated_by, created_at, updated_at
		 FROM feature_flags ORDER BY is_kill_switch DESC, name`)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	flags := make([]FeatureFlag, 0)
	for rows.Next() {
		var f FeatureFlag
		if err := rows.Scan(&f.ID, &f.FlagKey, &f.Name, &f.Description, &f.IsEnabled, &f.RolloutPercentage,
			&f.TargetCities, &f.TargetRoles, &f.IsKillSwitch,
			&f.CreatedBy, &f.UpdatedBy, &f.CreatedAt, &f.UpdatedAt); err == nil {
			flags = append(flags, f)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"flags": flags})
}

func (h *ConfigHandler) HandleUpsertFlag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		FlagKey           string   `json:"flag_key"`
		Name              string   `json:"name"`
		Description       string   `json:"description"`
		IsEnabled         *bool    `json:"is_enabled"`
		RolloutPercentage *int     `json:"rollout_percentage"`
		TargetCities      []string `json:"target_cities"`
		TargetRoles       []string `json:"target_roles"`
		IsKillSwitch      *bool    `json:"is_kill_switch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.FlagKey == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")

	// Attempt UPDATE first, INSERT if not found
	tag, err := h.dbPool.Exec(ctx,
		`UPDATE feature_flags SET
		    name                = COALESCE(NULLIF($2,''), name),
		    description         = COALESCE(NULLIF($3,''), description),
		    is_enabled          = COALESCE($4, is_enabled),
		    rollout_percentage  = COALESCE($5, rollout_percentage),
		    target_cities       = COALESCE($6, target_cities),
		    target_roles        = COALESCE($7, target_roles),
		    is_kill_switch      = COALESCE($8, is_kill_switch),
		    updated_by          = $9,
		    updated_at          = NOW()
		 WHERE flag_key = $1`,
		req.FlagKey, req.Name, req.Description,
		req.IsEnabled, req.RolloutPercentage, req.TargetCities, req.TargetRoles,
		req.IsKillSwitch, adminEmail)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		_, _ = h.dbPool.Exec(ctx,
			`INSERT INTO feature_flags (flag_key, name, description, is_enabled, rollout_percentage, target_cities, target_roles, is_kill_switch, created_by, updated_by)
			 VALUES ($1, $2, $3, COALESCE($4,false), COALESCE($5,0), COALESCE($6,'{}'), COALESCE($7,'{}'), COALESCE($8,false), $9, $9)`,
			req.FlagKey, req.Name, req.Description,
			req.IsEnabled, req.RolloutPercentage, req.TargetCities, req.TargetRoles,
			req.IsKillSwitch, adminEmail)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// ── 20.3 App Version Management ──────────────────────────────────────────────

type AppVersion struct {
	ID                  int       `json:"id"`
	Platform            string    `json:"platform"`
	VersionString       string    `json:"version_string"`
	BuildNumber         int       `json:"build_number"`
	ReleaseType         string    `json:"release_type"`
	MinSupportedVersion string    `json:"min_supported_version"`
	ReleaseNotes        string    `json:"release_notes"`
	StoreURL            string    `json:"store_url"`
	IsLatest            bool      `json:"is_latest"`
	CreatedBy           string    `json:"created_by"`
	CreatedAt           time.Time `json:"created_at"`
}

func (h *ConfigHandler) HandleGetAppVersions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx,
		`SELECT id, platform, version_string, build_number, release_type, min_supported_version,
		        release_notes, store_url, is_latest, created_by, created_at
		 FROM app_versions ORDER BY platform, created_at DESC`)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	versions := make([]AppVersion, 0)
	for rows.Next() {
		var v AppVersion
		if err := rows.Scan(&v.ID, &v.Platform, &v.VersionString, &v.BuildNumber, &v.ReleaseType,
			&v.MinSupportedVersion, &v.ReleaseNotes, &v.StoreURL, &v.IsLatest, &v.CreatedBy, &v.CreatedAt); err == nil {
			versions = append(versions, v)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"versions": versions})
}

func (h *ConfigHandler) HandleCreateAppVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req AppVersion
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.VersionString == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "tx_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	if req.IsLatest {
		_, _ = tx.Exec(ctx, `UPDATE app_versions SET is_latest = false WHERE platform = $1`, req.Platform)
	}

	adminEmail := r.Header.Get("X-Admin-Email")
	var id int
	err = tx.QueryRow(ctx,
		`INSERT INTO app_versions (platform, version_string, build_number, release_type, min_supported_version, release_notes, store_url, is_latest, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
		req.Platform, req.VersionString, req.BuildNumber, req.ReleaseType, req.MinSupportedVersion,
		req.ReleaseNotes, req.StoreURL, req.IsLatest, adminEmail,
	).Scan(&id)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	_ = tx.Commit(ctx)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (h *ConfigHandler) HandleSetLatestVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	tx, _ := h.dbPool.Begin(ctx)
	defer tx.Rollback(ctx)

	var platform string
	_ = tx.QueryRow(ctx, `SELECT platform FROM app_versions WHERE id = $1`, id).Scan(&platform)
	_, _ = tx.Exec(ctx, `UPDATE app_versions SET is_latest = false WHERE platform = $1`, platform)
	_, _ = tx.Exec(ctx, `UPDATE app_versions SET is_latest = true WHERE id = $1`, id)
	_ = tx.Commit(ctx)

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

// ── 20.4 Integration Configs ─────────────────────────────────────────────────

type IntegrationConfig struct {
	ID              int        `json:"id"`
	IntegrationKey  string     `json:"integration_key"`
	DisplayName     string     `json:"display_name"`
	Category        string     `json:"category"`
	LogoEmoji       string     `json:"logo_emoji"`
	IsEnabled       bool       `json:"is_enabled"`
	ConfigJSON      string     `json:"config_json"`
	APIKeyMasked    string     `json:"api_key_masked"`
	WebhookURL      string     `json:"webhook_url"`
	HealthStatus    string     `json:"health_status"`
	LastHealthCheck *time.Time `json:"last_health_check"`
	UpdatedBy       string     `json:"updated_by"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (h *ConfigHandler) HandleGetIntegrations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	category := r.URL.Query().Get("category")
	query := `SELECT id, integration_key, display_name, category, logo_emoji, is_enabled,
	                 config_json::TEXT, api_key_masked, webhook_url, health_status, last_health_check, updated_by, updated_at
	          FROM integration_configs WHERE 1=1`
	var args []interface{}
	if category != "" {
		query += " AND category = $1"
		args = append(args, category)
	}
	query += " ORDER BY category, display_name"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	integrations := make([]IntegrationConfig, 0)
	for rows.Next() {
		var ic IntegrationConfig
		if err := rows.Scan(&ic.ID, &ic.IntegrationKey, &ic.DisplayName, &ic.Category, &ic.LogoEmoji,
			&ic.IsEnabled, &ic.ConfigJSON, &ic.APIKeyMasked, &ic.WebhookURL,
			&ic.HealthStatus, &ic.LastHealthCheck, &ic.UpdatedBy, &ic.UpdatedAt); err == nil {
			integrations = append(integrations, ic)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"integrations": integrations})
}

func (h *ConfigHandler) HandleUpdateIntegration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	key := r.PathValue("key")
	var req struct {
		IsEnabled  *bool  `json:"is_enabled"`
		APIKey     string `json:"api_key"` // plaintext — we store masked version
		WebhookURL string `json:"webhook_url"`
		ConfigJSON string `json:"config_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	masked := ""
	if req.APIKey != "" {
		if len(req.APIKey) > 8 {
			masked = req.APIKey[:4] + strings.Repeat("*", len(req.APIKey)-8) + req.APIKey[len(req.APIKey)-4:]
		} else {
			masked = strings.Repeat("*", len(req.APIKey))
		}
	}

	query := `UPDATE integration_configs SET updated_by = $2, updated_at = NOW()`
	args := []interface{}{key, adminEmail}
	idx := 3
	if req.IsEnabled != nil {
		query += fmt.Sprintf(", is_enabled = $%d", idx)
		args = append(args, *req.IsEnabled)
		idx++
	}
	if masked != "" {
		query += fmt.Sprintf(", api_key_masked = $%d", idx)
		args = append(args, masked)
		idx++
	}
	if req.WebhookURL != "" {
		query += fmt.Sprintf(", webhook_url = $%d", idx)
		args = append(args, req.WebhookURL)
		idx++
	}
	if req.ConfigJSON != "" {
		query += fmt.Sprintf(", config_json = $%d::JSONB", idx)
		args = append(args, req.ConfigJSON)
		idx++
	}
	query += " WHERE integration_key = $1"
	_, _ = h.dbPool.Exec(ctx, query, args...)

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

func (h *ConfigHandler) HandleHealthCheckIntegration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	key := r.PathValue("key")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	// In production: actually ping the integration endpoint. Here we mark UNKNOWN→HEALTHY for enabled ones.
	var isEnabled bool
	err := h.dbPool.QueryRow(ctx, `SELECT is_enabled FROM integration_configs WHERE integration_key = $1`, key).Scan(&isEnabled)
	if err == pgx.ErrNoRows {
		http.Error(w, "integration_not_found", http.StatusNotFound)
		return
	}
	status := "DOWN"
	if isEnabled {
		status = "HEALTHY"
	}
	_, _ = h.dbPool.Exec(ctx,
		`UPDATE integration_configs SET health_status = $1, last_health_check = NOW() WHERE integration_key = $2`,
		status, key)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"health_status": status, "checked_at": time.Now()})
}

// ── 20.5 Notification Templates ──────────────────────────────────────────────

type NotificationTemplate struct {
	ID            int       `json:"id"`
	TemplateKey   string    `json:"template_key"`
	Name          string    `json:"name"`
	Channel       string    `json:"channel"`
	EventTrigger  string    `json:"event_trigger"`
	TitleTemplate string    `json:"title_template"`
	BodyTemplate  string    `json:"body_template"`
	Variables     []string  `json:"variables"`
	LanguageCode  string    `json:"language_code"`
	IsActive      bool      `json:"is_active"`
	CreatedBy     string    `json:"created_by"`
	UpdatedBy     string    `json:"updated_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (h *ConfigHandler) HandleGetTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	channel := r.URL.Query().Get("channel")
	lang := r.URL.Query().Get("language")
	query := `SELECT id, template_key, name, channel, event_trigger, title_template, body_template, variables, language_code, is_active, created_by, updated_by, created_at, updated_at
	          FROM notification_templates WHERE 1=1`
	var args []interface{}
	idx := 1
	if channel != "" {
		query += fmt.Sprintf(" AND channel = $%d", idx)
		args = append(args, strings.ToUpper(channel))
		idx++
	}
	if lang != "" {
		query += fmt.Sprintf(" AND language_code = $%d", idx)
		args = append(args, lang)
		idx++
	}
	query += " ORDER BY channel, name"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	templates := make([]NotificationTemplate, 0)
	for rows.Next() {
		var t NotificationTemplate
		if err := rows.Scan(&t.ID, &t.TemplateKey, &t.Name, &t.Channel, &t.EventTrigger,
			&t.TitleTemplate, &t.BodyTemplate, &t.Variables, &t.LanguageCode, &t.IsActive,
			&t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt); err == nil {
			templates = append(templates, t)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"templates": templates})
}

func (h *ConfigHandler) HandleUpsertTemplate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req NotificationTemplate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TemplateKey == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.LanguageCode == "" {
		req.LanguageCode = "en"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	adminEmail := r.Header.Get("X-Admin-Email")

	var id int
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO notification_templates
		 (template_key, name, channel, event_trigger, title_template, body_template, variables, language_code, is_active, created_by, updated_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
		 ON CONFLICT (template_key) DO UPDATE SET
		    name=$2, channel=$3, event_trigger=$4, title_template=$5, body_template=$6,
		    variables=$7, language_code=$8, is_active=$9, updated_by=$10, updated_at=NOW()
		 RETURNING id`,
		req.TemplateKey, req.Name, req.Channel, req.EventTrigger, req.TitleTemplate,
		req.BodyTemplate, req.Variables, req.LanguageCode, req.IsActive, adminEmail,
	).Scan(&id)
	if err != nil {
		h.logger.Printf("[CONFIG] upsert template failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

// ── 20.6 Cancellation Policy Rules ───────────────────────────────────────────

type CancellationRule struct {
	ID                        int     `json:"id"`
	RuleName                  string  `json:"rule_name"`
	AppliesTo                 string  `json:"applies_to"`
	TripStatusAtCancel        string  `json:"trip_status_at_cancel"`
	MinutesElapsedMin         int     `json:"minutes_elapsed_min"`
	MinutesElapsedMax         int     `json:"minutes_elapsed_max"`
	CancellationFeePct        float64 `json:"cancellation_fee_pct"`
	CancellationFeeFixedPaise int     `json:"cancellation_fee_fixed_paise"`
	RefundPct                 float64 `json:"refund_pct"`
	PartyAtFault              string  `json:"party_at_fault"`
	IsActive                  bool    `json:"is_active"`
	Priority                  int     `json:"priority"`
}

func (h *ConfigHandler) HandleGetCancellationRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx,
		`SELECT id, rule_name, applies_to, trip_status_at_cancel, minutes_elapsed_min, minutes_elapsed_max,
		        cancellation_fee_pct, cancellation_fee_fixed_paise, refund_pct, party_at_fault, is_active, priority
		 FROM cancellation_policy_rules ORDER BY priority DESC`)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	rules := make([]CancellationRule, 0)
	for rows.Next() {
		var rule CancellationRule
		if err := rows.Scan(&rule.ID, &rule.RuleName, &rule.AppliesTo, &rule.TripStatusAtCancel,
			&rule.MinutesElapsedMin, &rule.MinutesElapsedMax, &rule.CancellationFeePct,
			&rule.CancellationFeeFixedPaise, &rule.RefundPct, &rule.PartyAtFault, &rule.IsActive, &rule.Priority); err == nil {
			rules = append(rules, rule)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"rules": rules})
}

func (h *ConfigHandler) HandleUpsertCancellationRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req CancellationRule
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RuleName == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	adminEmail := r.Header.Get("X-Admin-Email")

	if req.ID > 0 {
		_, _ = h.dbPool.Exec(ctx,
			`UPDATE cancellation_policy_rules
			 SET rule_name=$2, applies_to=$3, trip_status_at_cancel=$4, minutes_elapsed_min=$5, minutes_elapsed_max=$6,
			     cancellation_fee_pct=$7, cancellation_fee_fixed_paise=$8, refund_pct=$9, party_at_fault=$10,
			     is_active=$11, priority=$12, updated_at=NOW()
			 WHERE id=$1`,
			req.ID, req.RuleName, req.AppliesTo, req.TripStatusAtCancel,
			req.MinutesElapsedMin, req.MinutesElapsedMax, req.CancellationFeePct,
			req.CancellationFeeFixedPaise, req.RefundPct, req.PartyAtFault, req.IsActive, req.Priority)
	} else {
		_ = h.dbPool.QueryRow(ctx,
			`INSERT INTO cancellation_policy_rules
			 (rule_name, applies_to, trip_status_at_cancel, minutes_elapsed_min, minutes_elapsed_max,
			  cancellation_fee_pct, cancellation_fee_fixed_paise, refund_pct, party_at_fault, is_active, priority, created_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
			req.RuleName, req.AppliesTo, req.TripStatusAtCancel, req.MinutesElapsedMin, req.MinutesElapsedMax,
			req.CancellationFeePct, req.CancellationFeeFixedPaise, req.RefundPct,
			req.PartyAtFault, req.IsActive, req.Priority, adminEmail).Scan(&req.ID)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": req.ID})
}

// ── 20.7 Rating Threshold Rules ───────────────────────────────────────────────

type RatingRule struct {
	ID                      int     `json:"id"`
	AppliesTo               string  `json:"applies_to"`
	ThresholdType           string  `json:"threshold_type"`
	MinTripsRequired        int     `json:"min_trips_required"`
	RatingBelow             float64 `json:"rating_below"`
	Action                  string  `json:"action"`
	CooldownDays            int     `json:"cooldown_days"`
	NotificationTemplateKey string  `json:"notification_template_key"`
	IsActive                bool    `json:"is_active"`
}

func (h *ConfigHandler) HandleGetRatingRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx,
		`SELECT id, applies_to, threshold_type, min_trips_required, rating_below,
		        action, cooldown_days, notification_template_key, is_active
		 FROM rating_threshold_rules ORDER BY applies_to, rating_below DESC`)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	rules := make([]RatingRule, 0)
	for rows.Next() {
		var rule RatingRule
		if err := rows.Scan(&rule.ID, &rule.AppliesTo, &rule.ThresholdType, &rule.MinTripsRequired,
			&rule.RatingBelow, &rule.Action, &rule.CooldownDays, &rule.NotificationTemplateKey, &rule.IsActive); err == nil {
			rules = append(rules, rule)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"rules": rules})
}

func (h *ConfigHandler) HandleUpsertRatingRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req RatingRule
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	if req.ID > 0 {
		_, _ = h.dbPool.Exec(ctx,
			`UPDATE rating_threshold_rules
			 SET applies_to=$2, threshold_type=$3, min_trips_required=$4, rating_below=$5,
			     action=$6, cooldown_days=$7, notification_template_key=$8, is_active=$9, updated_at=NOW()
			 WHERE id=$1`,
			req.ID, req.AppliesTo, req.ThresholdType, req.MinTripsRequired, req.RatingBelow,
			req.Action, req.CooldownDays, req.NotificationTemplateKey, req.IsActive)
	} else {
		_ = h.dbPool.QueryRow(ctx,
			`INSERT INTO rating_threshold_rules
			 (applies_to, threshold_type, min_trips_required, rating_below, action, cooldown_days, notification_template_key, is_active)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
			req.AppliesTo, req.ThresholdType, req.MinTripsRequired, req.RatingBelow,
			req.Action, req.CooldownDays, req.NotificationTemplateKey, req.IsActive).Scan(&req.ID)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": req.ID})
}
