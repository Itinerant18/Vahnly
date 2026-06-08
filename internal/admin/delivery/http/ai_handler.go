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
)

type AIHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewAIHandler(db *pgxpool.Pool, logger *log.Logger) *AIHandler {
	return &AIHandler{db: db, logger: logger}
}

func aiJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ── Fraud Detection ───────────────────────────────────────────────────────────

func (h *AIHandler) HandleGetFraudEvents(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	q := r.URL.Query()
	args := []any{}
	conds := []string{}
	idx := 1

	if v := q.Get("status"); v != "" {
		conds = append(conds, fmt.Sprintf("status = $%d", idx))
		args = append(args, v)
		idx++
	}
	if v := q.Get("fraud_type"); v != "" {
		conds = append(conds, fmt.Sprintf("fraud_type = $%d", idx))
		args = append(args, v)
		idx++
	}
	if v := q.Get("min_score"); v != "" {
		conds = append(conds, fmt.Sprintf("score >= $%d", idx))
		args = append(args, v)
		idx++
	}
	_ = idx
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	type FraudEvent struct {
		ID         string          `json:"id"`
		EntityType string          `json:"entity_type"`
		EntityID   string          `json:"entity_id"`
		FraudType  string          `json:"fraud_type"`
		Score      float64         `json:"score"`
		Evidence   json.RawMessage `json:"evidence"`
		Status     string          `json:"status"`
		ReviewedAt *time.Time      `json:"reviewed_at,omitempty"`
		CreatedAt  time.Time       `json:"created_at"`
	}

	sql := fmt.Sprintf(`SELECT id, entity_type, entity_id, fraud_type, score, evidence, status, reviewed_at, created_at
		FROM fraud_events %s ORDER BY score DESC, created_at DESC LIMIT 100`, where)

	rows, err := h.db.Query(ctx, sql, args...)
	if err != nil {
		h.logger.Printf("GetFraudEvents: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []FraudEvent{}
	for rows.Next() {
		var fe FraudEvent
		if err := rows.Scan(&fe.ID, &fe.EntityType, &fe.EntityID, &fe.FraudType, &fe.Score, &fe.Evidence, &fe.Status, &fe.ReviewedAt, &fe.CreatedAt); err != nil {
			continue
		}
		result = append(result, fe)
	}

	var totalOpen, totalConfirmed, totalDismissed int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FILTER (WHERE status='OPEN'), COUNT(*) FILTER (WHERE status='CONFIRMED'), COUNT(*) FILTER (WHERE status='DISMISSED') FROM fraud_events`).
		Scan(&totalOpen, &totalConfirmed, &totalDismissed)

	aiJSON(w, http.StatusOK, map[string]any{
		"events": result, "count": len(result),
		"summary": map[string]int{"open": totalOpen, "confirmed": totalConfirmed, "dismissed": totalDismissed},
	})
}

func (h *AIHandler) HandleUpdateFraudEvent(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	tag, err := h.db.Exec(ctx, `UPDATE fraud_events SET status = $1, reviewed_at = NOW() WHERE id = $2`, body.Status, id)
	if err != nil || tag.RowsAffected() == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	aiJSON(w, http.StatusOK, map[string]string{"id": id, "status": body.Status})
}

func (h *AIHandler) HandleGetFraudRules(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type Rule struct {
		ID            string    `json:"id"`
		RuleName      string    `json:"rule_name"`
		FraudType     string    `json:"fraud_type"`
		Description   string    `json:"description"`
		Threshold     float64   `json:"threshold"`
		Weight        float64   `json:"weight"`
		Action        string    `json:"action"`
		IsEnabled     bool      `json:"is_enabled"`
		TriggersToday int       `json:"triggers_today"`
		CreatedAt     time.Time `json:"created_at"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, rule_name, fraud_type, description, threshold, weight, action, is_enabled, triggers_today, created_at FROM fraud_rules ORDER BY fraud_type, rule_name`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Rule{}
	for rows.Next() {
		var rule Rule
		if err := rows.Scan(&rule.ID, &rule.RuleName, &rule.FraudType, &rule.Description, &rule.Threshold, &rule.Weight, &rule.Action, &rule.IsEnabled, &rule.TriggersToday, &rule.CreatedAt); err != nil {
			continue
		}
		result = append(result, rule)
	}
	aiJSON(w, http.StatusOK, map[string]any{"rules": result})
}

func (h *AIHandler) HandleUpdateFraudRule(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	var body struct {
		Threshold float64 `json:"threshold"`
		Weight    float64 `json:"weight"`
		Action    string  `json:"action"`
		IsEnabled bool    `json:"is_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	_, err := h.db.Exec(ctx, `UPDATE fraud_rules SET threshold=$1, weight=$2, action=$3, is_enabled=$4 WHERE id=$5`,
		body.Threshold, body.Weight, body.Action, body.IsEnabled, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	aiJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
}

// ── Demand Heatmap ────────────────────────────────────────────────────────────

func (h *AIHandler) HandleGetDemandForecasts(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	city := r.URL.Query().Get("city")
	args := []any{}
	conds := []string{"forecast_hour >= NOW()"}
	idx := 1
	if city != "" {
		conds = append(conds, fmt.Sprintf("city = $%d", idx))
		args = append(args, city)
		idx++
	}
	// Enforce the requesting admin's city scope (no-op for SUPER_ADMIN / ALL scope).
	if allowed := adminAllowedCities(r.Context()); allowed != nil {
		conds = append(conds, fmt.Sprintf("city = ANY($%d)", idx))
		args = append(args, allowed)
	}
	where := "WHERE " + strings.Join(conds, " AND ")

	type Forecast struct {
		ID              string    `json:"id"`
		City            string    `json:"city"`
		ZoneName        string    `json:"zone_name"`
		ForecastHour    time.Time `json:"forecast_hour"`
		PredictedDemand int       `json:"predicted_demand"`
		CurrentSupply   int       `json:"current_supply"`
		SurgePredicted  float64   `json:"surge_predicted"`
		ConfidencePct   int       `json:"confidence_pct"`
		Gap             int       `json:"gap"`
	}

	rows, err := h.db.Query(ctx, fmt.Sprintf(`SELECT id, city, zone_name, forecast_hour, predicted_demand, current_supply, surge_predicted, confidence_pct FROM demand_forecasts %s ORDER BY surge_predicted DESC, forecast_hour LIMIT 50`, where), args...)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Forecast{}
	for rows.Next() {
		var f Forecast
		if err := rows.Scan(&f.ID, &f.City, &f.ZoneName, &f.ForecastHour, &f.PredictedDemand, &f.CurrentSupply, &f.SurgePredicted, &f.ConfidencePct); err != nil {
			continue
		}
		f.Gap = f.PredictedDemand - f.CurrentSupply
		result = append(result, f)
	}
	aiJSON(w, http.StatusOK, map[string]any{"forecasts": result})
}

// ── Voice of Customer ─────────────────────────────────────────────────────────

func (h *AIHandler) HandleGetVoCTopics(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type Topic struct {
		ID             string  `json:"id"`
		Topic          string  `json:"topic"`
		Source         string  `json:"source"`
		MentionCount   int     `json:"mention_count"`
		PositiveCount  int     `json:"positive_count"`
		NegativeCount  int     `json:"negative_count"`
		SentimentScore float64 `json:"sentiment_score"`
		PeriodStart    string  `json:"period_start"`
		PeriodEnd      string  `json:"period_end"`
		Trending       bool    `json:"trending"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, topic, source, mention_count, positive_count, negative_count, sentiment_score, period_start::text, period_end::text, trending FROM voc_topics ORDER BY trending DESC, mention_count DESC LIMIT 50`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Topic{}
	for rows.Next() {
		var t Topic
		if err := rows.Scan(&t.ID, &t.Topic, &t.Source, &t.MentionCount, &t.PositiveCount, &t.NegativeCount, &t.SentimentScore, &t.PeriodStart, &t.PeriodEnd, &t.Trending); err != nil {
			continue
		}
		result = append(result, t)
	}

	type Sample struct {
		ID         string    `json:"id"`
		TopicID    string    `json:"topic_id"`
		EntityType string    `json:"entity_type"`
		Content    string    `json:"content"`
		Sentiment  string    `json:"sentiment"`
		CreatedAt  time.Time `json:"created_at"`
	}
	sampleRows, err := h.db.Query(ctx, `SELECT id, topic_id, entity_type, content, sentiment, created_at FROM voc_samples ORDER BY created_at DESC LIMIT 20`)
	samples := []Sample{}
	if err == nil {
		defer sampleRows.Close()
		for sampleRows.Next() {
			var s Sample
			if err := sampleRows.Scan(&s.ID, &s.TopicID, &s.EntityType, &s.Content, &s.Sentiment, &s.CreatedAt); err != nil {
				continue
			}
			samples = append(samples, s)
		}
	}

	aiJSON(w, http.StatusOK, map[string]any{"topics": result, "samples": samples})
}
