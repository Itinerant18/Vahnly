package http

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeveloperHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewDeveloperHandler(dbPool *pgxpool.Pool, logger *log.Logger) *DeveloperHandler {
	return &DeveloperHandler{dbPool: dbPool, logger: logger}
}

// ── API Keys ─────────────────────────────────────────────────────────────────

type APIKey struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	KeyPrefix       string     `json:"key_prefix"`
	OwnerType       string     `json:"owner_type"`
	OwnerID         string     `json:"owner_id"`
	OwnerName       string     `json:"owner_name"`
	Scopes          []string   `json:"scopes"`
	RateLimitPerMin int        `json:"rate_limit_per_min"`
	RateLimitPerDay int        `json:"rate_limit_per_day"`
	QuotaMonthly    int        `json:"quota_monthly"`
	IsSandbox       bool       `json:"is_sandbox"`
	IsActive        bool       `json:"is_active"`
	LastUsedAt      *time.Time `json:"last_used_at"`
	ExpiresAt       *time.Time `json:"expires_at"`
	CreatedBy       string     `json:"created_by"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (h *DeveloperHandler) HandleGetKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	isSandbox := r.URL.Query().Get("sandbox")
	query := `SELECT id::TEXT, name, key_prefix, owner_type, owner_id, owner_name, scopes,
	                 rate_limit_per_min, rate_limit_per_day, quota_monthly,
	                 is_sandbox, is_active, last_used_at, expires_at, created_by, created_at, updated_at
	          FROM api_keys WHERE 1=1`
	var args []interface{}
	if isSandbox == "true" {
		query += " AND is_sandbox = true"
	} else if isSandbox == "false" {
		query += " AND is_sandbox = false"
	}
	query += " ORDER BY created_at DESC"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	keys := make([]APIKey, 0)
	for rows.Next() {
		var k APIKey
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &k.OwnerType, &k.OwnerID, &k.OwnerName, &k.Scopes,
			&k.RateLimitPerMin, &k.RateLimitPerDay, &k.QuotaMonthly,
			&k.IsSandbox, &k.IsActive, &k.LastUsedAt, &k.ExpiresAt, &k.CreatedBy, &k.CreatedAt, &k.UpdatedAt); err == nil {
			keys = append(keys, k)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
}

// HandleCreateKey generates a new API key and returns the plaintext key ONCE.
func (h *DeveloperHandler) HandleCreateKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name            string   `json:"name"`
		OwnerType       string   `json:"owner_type"`
		OwnerID         string   `json:"owner_id"`
		OwnerName       string   `json:"owner_name"`
		Scopes          []string `json:"scopes"`
		RateLimitPerMin int      `json:"rate_limit_per_min"`
		RateLimitPerDay int      `json:"rate_limit_per_day"`
		QuotaMonthly    int      `json:"quota_monthly"`
		IsSandbox       bool     `json:"is_sandbox"`
		ExpiresAt       *string  `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	// Generate a cryptographically-random key
	rawBytes := make([]byte, 24)
	if _, err := rand.Read(rawBytes); err != nil {
		http.Error(w, "key_generation_failed", http.StatusInternalServerError)
		return
	}
	prefix := "dfukey_sb"
	if !req.IsSandbox {
		prefix = "dfukey_lv"
	}
	plaintextKey := prefix + "_" + hex.EncodeToString(rawBytes)
	hashBytes := sha256.Sum256([]byte(plaintextKey))
	keyHash := hex.EncodeToString(hashBytes[:])
	displayPrefix := plaintextKey[:min(12, len(plaintextKey))]

	if req.RateLimitPerMin == 0 {
		req.RateLimitPerMin = 60
	}
	if req.RateLimitPerDay == 0 {
		req.RateLimitPerDay = 10000
	}
	if req.QuotaMonthly == 0 {
		req.QuotaMonthly = 100000
	}
	if req.OwnerType == "" {
		req.OwnerType = "PARTNER"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	var id string
	var expiresAt *time.Time
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		if t, err := time.Parse("2006-01-02", *req.ExpiresAt); err == nil {
			expiresAt = &t
		}
	}

	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO api_keys
		 (name, key_prefix, key_hash, owner_type, owner_id, owner_name, scopes,
		  rate_limit_per_min, rate_limit_per_day, quota_monthly, is_sandbox, expires_at, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id::TEXT`,
		req.Name, displayPrefix, keyHash, req.OwnerType, req.OwnerID, req.OwnerName, req.Scopes,
		req.RateLimitPerMin, req.RateLimitPerDay, req.QuotaMonthly, req.IsSandbox, expiresAt, adminEmail,
	).Scan(&id)
	if err != nil {
		h.logger.Printf("[DEV] create key failed: %v", err)
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	// Return plaintext key ONCE — it cannot be retrieved again
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":         id,
		"key":        plaintextKey,
		"key_prefix": displayPrefix,
		"warning":    "Store this key securely. It will NOT be shown again.",
	})
}

func (h *DeveloperHandler) HandleUpdateKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	var req struct {
		IsActive        *bool    `json:"is_active"`
		RateLimitPerMin *int     `json:"rate_limit_per_min"`
		RateLimitPerDay *int     `json:"rate_limit_per_day"`
		QuotaMonthly    *int     `json:"quota_monthly"`
		Scopes          []string `json:"scopes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	query := `UPDATE api_keys SET updated_at = NOW()`
	args := []interface{}{}
	idx := 1
	if req.IsActive != nil {
		query += fmt.Sprintf(", is_active = $%d", idx)
		args = append(args, *req.IsActive)
		idx++
	}
	if req.RateLimitPerMin != nil {
		query += fmt.Sprintf(", rate_limit_per_min = $%d", idx)
		args = append(args, *req.RateLimitPerMin)
		idx++
	}
	if req.RateLimitPerDay != nil {
		query += fmt.Sprintf(", rate_limit_per_day = $%d", idx)
		args = append(args, *req.RateLimitPerDay)
		idx++
	}
	if req.QuotaMonthly != nil {
		query += fmt.Sprintf(", quota_monthly = $%d", idx)
		args = append(args, *req.QuotaMonthly)
		idx++
	}
	if req.Scopes != nil {
		query += fmt.Sprintf(", scopes = $%d", idx)
		args = append(args, req.Scopes)
		idx++
	}
	query += fmt.Sprintf(" WHERE id = $%d::uuid", idx)
	args = append(args, id)

	_, _ = h.dbPool.Exec(ctx, query, args...)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

func (h *DeveloperHandler) HandleRevokeKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	_, _ = h.dbPool.Exec(ctx, `UPDATE api_keys SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`, id)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"revoked"}`))
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

type Webhook struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	EndpointURL      string     `json:"endpoint_url"`
	OwnerType        string     `json:"owner_type"`
	OwnerID          string     `json:"owner_id"`
	SubscribedEvents []string   `json:"subscribed_events"`
	SigningSecret    string     `json:"signing_secret"`
	IsActive         bool       `json:"is_active"`
	RetryCount       int        `json:"retry_count"`
	TimeoutMs        int        `json:"timeout_ms"`
	LastTriggeredAt  *time.Time `json:"last_triggered_at"`
	LastStatusCode   *int       `json:"last_status_code"`
	FailureCount     int        `json:"failure_count"`
	CreatedBy        string     `json:"created_by"`
	CreatedAt        time.Time  `json:"created_at"`
}

var AllWebhookEvents = []string{
	"trip.created", "trip.assigned", "trip.started", "trip.completed", "trip.cancelled",
	"payment.completed", "payment.refunded", "payout.processed", "payout.failed",
	"driver.suspended", "driver.kyc_approved", "driver.kyc_rejected",
	"rider.suspended", "sos.triggered",
}

func (h *DeveloperHandler) HandleGetWebhooks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := h.dbPool.Query(ctx,
		`SELECT id::TEXT, name, endpoint_url, owner_type, owner_id, subscribed_events,
		        signing_secret, is_active, retry_count, timeout_ms,
		        last_triggered_at, last_status_code, failure_count, created_by, created_at
		 FROM webhooks ORDER BY created_at DESC`)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	webhooks := make([]Webhook, 0)
	for rows.Next() {
		var wh Webhook
		if err := rows.Scan(&wh.ID, &wh.Name, &wh.EndpointURL, &wh.OwnerType, &wh.OwnerID,
			&wh.SubscribedEvents, &wh.SigningSecret, &wh.IsActive,
			&wh.RetryCount, &wh.TimeoutMs, &wh.LastTriggeredAt, &wh.LastStatusCode,
			&wh.FailureCount, &wh.CreatedBy, &wh.CreatedAt); err == nil {
			// Mask signing secret — show only last 6 chars
			if len(wh.SigningSecret) > 6 {
				wh.SigningSecret = strings.Repeat("*", len(wh.SigningSecret)-6) + wh.SigningSecret[len(wh.SigningSecret)-6:]
			}
			webhooks = append(webhooks, wh)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"webhooks": webhooks, "available_events": AllWebhookEvents})
}

func (h *DeveloperHandler) HandleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name             string   `json:"name"`
		EndpointURL      string   `json:"endpoint_url"`
		OwnerType        string   `json:"owner_type"`
		OwnerID          string   `json:"owner_id"`
		SubscribedEvents []string `json:"subscribed_events"`
		RetryCount       int      `json:"retry_count"`
		TimeoutMs        int      `json:"timeout_ms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.EndpointURL == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	if req.RetryCount == 0 {
		req.RetryCount = 3
	}
	if req.TimeoutMs == 0 {
		req.TimeoutMs = 5000
	}
	if req.OwnerType == "" {
		req.OwnerType = "PARTNER"
	}

	// Generate signing secret
	secretBytes := make([]byte, 16)
	_, _ = rand.Read(secretBytes)
	signingSecret := "whs_" + hex.EncodeToString(secretBytes)

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	var id string
	err := h.dbPool.QueryRow(ctx,
		`INSERT INTO webhooks (name, endpoint_url, owner_type, owner_id, subscribed_events, signing_secret, retry_count, timeout_ms, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::TEXT`,
		req.Name, req.EndpointURL, req.OwnerType, req.OwnerID, req.SubscribedEvents,
		signingSecret, req.RetryCount, req.TimeoutMs, adminEmail,
	).Scan(&id)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "signing_secret": signingSecret})
}

func (h *DeveloperHandler) HandleUpdateWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	var req struct {
		IsActive         *bool    `json:"is_active"`
		SubscribedEvents []string `json:"subscribed_events"`
		EndpointURL      string   `json:"endpoint_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	query := `UPDATE webhooks SET updated_at = NOW()`
	args := []interface{}{}
	idx := 1
	if req.IsActive != nil {
		query += fmt.Sprintf(", is_active = $%d", idx)
		args = append(args, *req.IsActive)
		idx++
	}
	if len(req.SubscribedEvents) > 0 {
		query += fmt.Sprintf(", subscribed_events = $%d", idx)
		args = append(args, req.SubscribedEvents)
		idx++
	}
	if req.EndpointURL != "" {
		query += fmt.Sprintf(", endpoint_url = $%d", idx)
		args = append(args, req.EndpointURL)
		idx++
	}
	query += fmt.Sprintf(" WHERE id = $%d::uuid", idx)
	args = append(args, id)
	_, _ = h.dbPool.Exec(ctx, query, args...)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"updated"}`))
}

func (h *DeveloperHandler) HandleTestWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var url string
	err := h.dbPool.QueryRow(ctx, `SELECT endpoint_url FROM webhooks WHERE id = $1::uuid`, id).Scan(&url)
	if err == pgx.ErrNoRows {
		http.Error(w, "webhook_not_found", http.StatusNotFound)
		return
	}
	// In production: fire an actual HTTP request to `url` with a test payload.
	// Here: simulate success and record the trigger.
	_, _ = h.dbPool.Exec(ctx, `UPDATE webhooks SET last_triggered_at = NOW(), last_status_code = 200 WHERE id = $1::uuid`, id)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "test_dispatched",
		"endpoint":    url,
		"status_code": 200,
	})
}

// ── API Logs ──────────────────────────────────────────────────────────────────

type APILogEntry struct {
	ID             int64     `json:"id"`
	KeyPrefix      string    `json:"key_prefix"`
	Method         string    `json:"method"`
	Path           string    `json:"path"`
	StatusCode     int       `json:"status_code"`
	ResponseTimeMs int       `json:"response_time_ms"`
	IPAddress      string    `json:"ip_address"`
	IsSandbox      bool      `json:"is_sandbox"`
	ErrorMessage   *string   `json:"error_message"`
	CreatedAt      time.Time `json:"created_at"`
}

func (h *DeveloperHandler) HandleGetAPILogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	q := r.URL.Query()
	limit := parseBoundedQueryInt(q.Get("limit"), 50, 1, 200)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 1_000_000)
	keyPrefix := q.Get("key_prefix")
	statusCode := q.Get("status_code")

	base := `FROM api_request_logs WHERE 1=1`
	args := []interface{}{}
	idx := 1
	if keyPrefix != "" {
		base += fmt.Sprintf(" AND key_prefix = $%d", idx)
		args = append(args, keyPrefix)
		idx++
	}
	if statusCode != "" {
		base += fmt.Sprintf(" AND status_code = $%d", idx)
		args = append(args, statusCode)
		idx++
	}

	var total int64
	_ = h.dbPool.QueryRow(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total)

	query := `SELECT id, key_prefix, method, path, status_code, response_time_ms, ip_address, is_sandbox, error_message, created_at ` +
		base + fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := make([]APILogEntry, 0)
	for rows.Next() {
		var e APILogEntry
		if err := rows.Scan(&e.ID, &e.KeyPrefix, &e.Method, &e.Path, &e.StatusCode,
			&e.ResponseTimeMs, &e.IPAddress, &e.IsSandbox, &e.ErrorMessage, &e.CreatedAt); err == nil {
			entries = append(entries, e)
		}
	}

	// Stats
	type Stats struct {
		Total         int64   `json:"total"`
		ErrorRate     float64 `json:"error_rate"`
		AvgResponseMs float64 `json:"avg_response_ms"`
		P99ResponseMs float64 `json:"p99_response_ms"`
	}
	var stats Stats
	stats.Total = total
	_ = h.dbPool.QueryRow(ctx,
		`SELECT ROUND(100.0*COUNT(*) FILTER (WHERE status_code >= 400)/NULLIF(COUNT(*),0),2),
		        ROUND(AVG(response_time_ms),1),
		        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)
		 `+base, args[:len(args)-2]...,
	).Scan(&stats.ErrorRate, &stats.AvgResponseMs, &stats.P99ResponseMs)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"logs":  entries,
		"total": total,
		"stats": stats,
	})
}

// ── Status Page Incidents ─────────────────────────────────────────────────────

type StatusIncident struct {
	ID                 int        `json:"id"`
	Title              string     `json:"title"`
	Description        string     `json:"description"`
	Severity           string     `json:"severity"`
	Status             string     `json:"status"`
	AffectedComponents []string   `json:"affected_components"`
	StartedAt          time.Time  `json:"started_at"`
	ResolvedAt         *time.Time `json:"resolved_at"`
	CreatedBy          string     `json:"created_by"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

func (h *DeveloperHandler) HandleGetIncidents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	status := r.URL.Query().Get("status")
	query := `SELECT id, title, description, severity, status, affected_components,
	                 started_at, resolved_at, created_by, updated_at
	          FROM status_incidents WHERE 1=1`
	var args []interface{}
	if status != "" {
		query += " AND status = $1"
		args = append(args, strings.ToUpper(status))
	}
	query += " ORDER BY started_at DESC LIMIT 50"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		http.Error(w, "db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	incidents := make([]StatusIncident, 0)
	for rows.Next() {
		var si StatusIncident
		if err := rows.Scan(&si.ID, &si.Title, &si.Description, &si.Severity, &si.Status,
			&si.AffectedComponents, &si.StartedAt, &si.ResolvedAt, &si.CreatedBy, &si.UpdatedAt); err == nil {
			incidents = append(incidents, si)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"incidents": incidents})
}

func (h *DeveloperHandler) HandleUpsertIncident(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req StatusIncident
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Title == "" {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	adminEmail := r.Header.Get("X-Admin-Email")
	if req.ID > 0 {
		var resolvedAt interface{} = nil
		if req.Status == "RESOLVED" && req.ResolvedAt == nil {
			now := time.Now()
			req.ResolvedAt = &now
		}
		if req.ResolvedAt != nil {
			resolvedAt = req.ResolvedAt
		}
		_, _ = h.dbPool.Exec(ctx,
			`UPDATE status_incidents SET title=$2, description=$3, severity=$4, status=$5,
			        affected_components=$6, resolved_at=$7, updated_by=$8, updated_at=NOW() WHERE id=$1`,
			req.ID, req.Title, req.Description, req.Severity, req.Status,
			req.AffectedComponents, resolvedAt, adminEmail)
	} else {
		_ = h.dbPool.QueryRow(ctx,
			`INSERT INTO status_incidents (title, description, severity, status, affected_components, started_at, created_by, updated_by)
			 VALUES ($1,$2,$3,$4,$5,NOW(),$6,$6) RETURNING id`,
			req.Title, req.Description, req.Severity, req.Status, req.AffectedComponents, adminEmail).Scan(&req.ID)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": req.ID})
}
