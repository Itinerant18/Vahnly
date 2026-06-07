package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PlatformHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewPlatformHandler(db *pgxpool.Pool, logger *log.Logger) *PlatformHandler {
	return &PlatformHandler{db: db, logger: logger}
}

func platJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ── Service Health ────────────────────────────────────────────────────────────

func (h *PlatformHandler) HandleGetServiceHealth(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type Snapshot struct {
		ServiceName     string    `json:"service_name"`
		UptimePct       float64   `json:"uptime_pct"`
		ErrorRatePct    float64   `json:"error_rate_pct"`
		P50LatencyMs    int       `json:"p50_latency_ms"`
		P95LatencyMs    int       `json:"p95_latency_ms"`
		P99LatencyMs    int       `json:"p99_latency_ms"`
		RequestsPerMin  int       `json:"requests_per_min"`
		RecordedAt      time.Time `json:"recorded_at"`
	}

	rows, err := h.db.Query(ctx, `SELECT DISTINCT ON (service_name) service_name, uptime_pct, error_rate_pct, p50_latency_ms, p95_latency_ms, p99_latency_ms, requests_per_min, recorded_at FROM service_health_snapshots ORDER BY service_name, recorded_at DESC`)
	if err != nil {
		h.logger.Printf("GetServiceHealth: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Snapshot{}
	for rows.Next() {
		var s Snapshot
		if err := rows.Scan(&s.ServiceName, &s.UptimePct, &s.ErrorRatePct, &s.P50LatencyMs, &s.P95LatencyMs, &s.P99LatencyMs, &s.RequestsPerMin, &s.RecordedAt); err != nil {
			continue
		}
		result = append(result, s)
	}

	type Incident struct {
		ID                string     `json:"id"`
		ServiceName       string     `json:"service_name"`
		Title             string     `json:"title"`
		Severity          string     `json:"severity"`
		Status            string     `json:"status"`
		ImpactDescription string     `json:"impact_description"`
		StartedAt         time.Time  `json:"started_at"`
		ResolvedAt        *time.Time `json:"resolved_at,omitempty"`
		RootCause         string     `json:"root_cause"`
	}

	incRows, err := h.db.Query(ctx, `SELECT id, service_name, title, severity, status, impact_description, started_at, resolved_at, root_cause FROM health_incidents ORDER BY started_at DESC LIMIT 20`)
	incidents := []Incident{}
	if err == nil {
		defer incRows.Close()
		for incRows.Next() {
			var inc Incident
			if err := incRows.Scan(&inc.ID, &inc.ServiceName, &inc.Title, &inc.Severity, &inc.Status, &inc.ImpactDescription, &inc.StartedAt, &inc.ResolvedAt, &inc.RootCause); err != nil {
				continue
			}
			incidents = append(incidents, inc)
		}
	}

	platJSON(w, http.StatusOK, map[string]any{"services": result, "incidents": incidents})
}

func (h *PlatformHandler) HandleUpsertHealthIncident(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPost, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		ServiceName       string `json:"service_name"`
		Title             string `json:"title"`
		Severity          string `json:"severity"`
		Status            string `json:"status"`
		ImpactDescription string `json:"impact_description"`
		RootCause         string `json:"root_cause"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	if id != "" {
		var resolvedAt any
		if body.Status == "RESOLVED" {
			resolvedAt = "NOW()"
		}
		_, err := h.db.Exec(ctx, `UPDATE health_incidents SET status=$1, root_cause=$2, resolved_at=CASE WHEN $1='RESOLVED' THEN NOW() ELSE resolved_at END WHERE id=$3`, body.Status, body.RootCause, id)
		if err != nil {
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		_ = resolvedAt
		platJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO health_incidents (service_name, title, severity, status, impact_description, root_cause) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		body.ServiceName, body.Title, body.Severity, body.Status, body.ImpactDescription, body.RootCause).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	platJSON(w, http.StatusCreated, map[string]string{"id": newID})
}

// ── Experiments ───────────────────────────────────────────────────────────────

func (h *PlatformHandler) HandleGetExperiments(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type Experiment struct {
		ID           string          `json:"id"`
		Name         string          `json:"name"`
		Description  string          `json:"description"`
		Hypothesis   string          `json:"hypothesis"`
		Metric       string          `json:"metric"`
		Status       string          `json:"status"`
		Variants     json.RawMessage `json:"variants"`
		TargetCities []string        `json:"target_cities"`
		StartDate    *string         `json:"start_date,omitempty"`
		EndDate      *string         `json:"end_date,omitempty"`
		CreatedAt    time.Time       `json:"created_at"`
	}

	type Result struct {
		ExperimentID    string   `json:"experiment_id"`
		VariantName     string   `json:"variant_name"`
		SampleSize      int      `json:"sample_size"`
		ConversionRate  float64  `json:"conversion_rate"`
		AvgMetricValue  float64  `json:"avg_metric_value"`
		PValue          *float64 `json:"p_value,omitempty"`
		IsWinner        bool     `json:"is_winner"`
	}

	// Enforce city scope: scoped admins see experiments targeting their cities plus
	// global experiments (empty target_cities). SUPER_ADMIN / ALL scope sees everything.
	const expSelect = `SELECT id, name, description, hypothesis, metric, status, variants, target_cities, start_date::text, end_date::text, created_at FROM experiments`
	var rows pgx.Rows
	var err error
	if allowed := adminAllowedCities(ctx); allowed != nil {
		rows, err = h.db.Query(ctx, expSelect+` WHERE cardinality(target_cities) = 0 OR target_cities && $1 ORDER BY created_at DESC`, allowed)
	} else {
		rows, err = h.db.Query(ctx, expSelect+` ORDER BY created_at DESC`)
	}
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	experiments := []Experiment{}
	for rows.Next() {
		var e Experiment
		if err := rows.Scan(&e.ID, &e.Name, &e.Description, &e.Hypothesis, &e.Metric, &e.Status, &e.Variants, &e.TargetCities, &e.StartDate, &e.EndDate, &e.CreatedAt); err != nil {
			continue
		}
		if e.TargetCities == nil {
			e.TargetCities = []string{}
		}
		experiments = append(experiments, e)
	}

	resRows, _ := h.db.Query(ctx, `SELECT experiment_id, variant_name, sample_size, conversion_rate, avg_metric_value, p_value, is_winner FROM experiment_results ORDER BY experiment_id, is_winner DESC`)
	results := []Result{}
	if resRows != nil {
		defer resRows.Close()
		for resRows.Next() {
			var res Result
			if err := resRows.Scan(&res.ExperimentID, &res.VariantName, &res.SampleSize, &res.ConversionRate, &res.AvgMetricValue, &res.PValue, &res.IsWinner); err != nil {
				continue
			}
			results = append(results, res)
		}
	}

	platJSON(w, http.StatusOK, map[string]any{"experiments": experiments, "results": results})
}

func (h *PlatformHandler) HandleUpsertExperiment(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPost, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		Name         string          `json:"name"`
		Description  string          `json:"description"`
		Hypothesis   string          `json:"hypothesis"`
		Metric       string          `json:"metric"`
		Status       string          `json:"status"`
		Variants     json.RawMessage `json:"variants"`
		TargetCities []string        `json:"target_cities"`
		StartDate    string          `json:"start_date"`
		EndDate      string          `json:"end_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	if id != "" {
		_, err := h.db.Exec(ctx, `UPDATE experiments SET description=$1, hypothesis=$2, metric=$3, status=$4, variants=$5, target_cities=$6, start_date=$7, end_date=$8 WHERE id=$9`,
			body.Description, body.Hypothesis, body.Metric, body.Status, body.Variants, body.TargetCities, nullStr(body.StartDate), nullStr(body.EndDate), id)
		if err != nil {
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		platJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO experiments (name, description, hypothesis, metric, status, variants, target_cities, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		body.Name, body.Description, body.Hypothesis, body.Metric, body.Status, body.Variants, body.TargetCities, nullStr(body.StartDate), nullStr(body.EndDate)).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	platJSON(w, http.StatusCreated, map[string]string{"id": newID})
}

// ── Chatbot ───────────────────────────────────────────────────────────────────

func (h *PlatformHandler) HandleGetChatbotStats(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var totalSessions, deflected, escalated, active int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE deflected), COUNT(*) FILTER (WHERE status='ESCALATED'), COUNT(*) FILTER (WHERE status='ACTIVE') FROM chatbot_sessions`).
		Scan(&totalSessions, &deflected, &escalated, &active)

	type Intent struct {
		ID                  string   `json:"id"`
		IntentName          string   `json:"intent_name"`
		ResponseTemplate    string   `json:"response_template"`
		ConfidenceThreshold float64  `json:"confidence_threshold"`
		FallbackToHuman     bool     `json:"fallback_to_human"`
		TriggerCount        int      `json:"trigger_count"`
		IsActive            bool     `json:"is_active"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, intent_name, response_template, confidence_threshold, fallback_to_human, trigger_count, is_active FROM chatbot_intents ORDER BY trigger_count DESC`)
	intents := []Intent{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var intent Intent
			if err := rows.Scan(&intent.ID, &intent.IntentName, &intent.ResponseTemplate, &intent.ConfidenceThreshold, &intent.FallbackToHuman, &intent.TriggerCount, &intent.IsActive); err != nil {
				continue
			}
			intents = append(intents, intent)
		}
	}

	deflectionRate := 0.0
	if totalSessions > 0 {
		deflectionRate = float64(deflected) / float64(totalSessions) * 100
	}

	platJSON(w, http.StatusOK, map[string]any{
		"stats": map[string]any{
			"total_sessions": totalSessions, "deflected": deflected, "escalated": escalated,
			"active": active, "deflection_rate_pct": deflectionRate,
		},
		"intents": intents,
	})
}

func (h *PlatformHandler) HandleUpsertChatbotIntent(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPost, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		IntentName          string  `json:"intent_name"`
		ResponseTemplate    string  `json:"response_template"`
		ConfidenceThreshold float64 `json:"confidence_threshold"`
		FallbackToHuman     bool    `json:"fallback_to_human"`
		IsActive            bool    `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	if id != "" {
		_, err := h.db.Exec(ctx, `UPDATE chatbot_intents SET response_template=$1, confidence_threshold=$2, fallback_to_human=$3, is_active=$4 WHERE id=$5`,
			body.ResponseTemplate, body.ConfidenceThreshold, body.FallbackToHuman, body.IsActive, id)
		if err != nil {
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		platJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO chatbot_intents (intent_name, response_template, confidence_threshold, fallback_to_human, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		body.IntentName, body.ResponseTemplate, body.ConfidenceThreshold, body.FallbackToHuman, body.IsActive).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	platJSON(w, http.StatusCreated, map[string]string{"id": newID})
}

// nullStr converts empty string to nil for optional DB fields.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
