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

type DriverOpsHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewDriverOpsHandler(db *pgxpool.Pool, logger *log.Logger) *DriverOpsHandler {
	return &DriverOpsHandler{db: db, logger: logger}
}

func dopsJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ── Incentives ────────────────────────────────────────────────────────────────

func (h *DriverOpsHandler) HandleGetIncentiveCampaigns(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type Campaign struct {
		ID              string          `json:"id"`
		Name            string          `json:"name"`
		TriggerType     string          `json:"trigger_type"`
		ConditionConfig json.RawMessage `json:"condition_config"`
		RewardType      string          `json:"reward_type"`
		RewardValue     int             `json:"reward_value"`
		TargetCities    []string        `json:"target_cities"`
		StartsAt        time.Time       `json:"starts_at"`
		EndsAt          time.Time       `json:"ends_at"`
		IsActive        bool            `json:"is_active"`
		DriversTargeted int             `json:"drivers_targeted"`
		DriversClaimed  int             `json:"drivers_claimed"`
	}

	// Enforce city scope: scoped admins see campaigns targeting their cities plus
	// global campaigns (empty target_cities). SUPER_ADMIN / ALL scope sees everything.
	const baseSelect = `SELECT id, name, trigger_type, condition_config, reward_type, reward_value, target_cities, starts_at, ends_at, is_active, drivers_targeted, drivers_claimed FROM incentive_campaigns`
	var rows pgx.Rows
	var err error
	if allowed := adminAllowedCities(ctx); allowed != nil {
		rows, err = h.db.Query(ctx, baseSelect+` WHERE cardinality(target_cities) = 0 OR target_cities && $1 ORDER BY created_at DESC`, allowed)
	} else {
		rows, err = h.db.Query(ctx, baseSelect+` ORDER BY created_at DESC`)
	}
	if err != nil {
		h.logger.Printf("GetIncentiveCampaigns: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Campaign{}
	for rows.Next() {
		var c Campaign
		if err := rows.Scan(&c.ID, &c.Name, &c.TriggerType, &c.ConditionConfig, &c.RewardType, &c.RewardValue, &c.TargetCities, &c.StartsAt, &c.EndsAt, &c.IsActive, &c.DriversTargeted, &c.DriversClaimed); err != nil {
			continue
		}
		if c.TargetCities == nil {
			c.TargetCities = []string{}
		}
		result = append(result, c)
	}
	dopsJSON(w, http.StatusOK, map[string]any{"campaigns": result})
}

func (h *DriverOpsHandler) HandleUpsertIncentiveCampaign(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPost, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		Name            string          `json:"name"`
		TriggerType     string          `json:"trigger_type"`
		ConditionConfig json.RawMessage `json:"condition_config"`
		RewardType      string          `json:"reward_type"`
		RewardValue     int             `json:"reward_value"`
		TargetCities    []string        `json:"target_cities"`
		StartsAt        string          `json:"starts_at"`
		EndsAt          string          `json:"ends_at"`
		IsActive        bool            `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	if id != "" {
		_, err := h.db.Exec(ctx, `UPDATE incentive_campaigns SET name=$1, trigger_type=$2, condition_config=$3, reward_type=$4, reward_value=$5, target_cities=$6, starts_at=$7, ends_at=$8, is_active=$9 WHERE id=$10`,
			body.Name, body.TriggerType, body.ConditionConfig, body.RewardType, body.RewardValue, body.TargetCities, body.StartsAt, body.EndsAt, body.IsActive, id)
		if err != nil {
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		dopsJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO incentive_campaigns (name, trigger_type, condition_config, reward_type, reward_value, target_cities, starts_at, ends_at, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		body.Name, body.TriggerType, body.ConditionConfig, body.RewardType, body.RewardValue, body.TargetCities, body.StartsAt, body.EndsAt, body.IsActive).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	dopsJSON(w, http.StatusCreated, map[string]string{"id": newID, "status": "created"})
}

// ── Coaching ──────────────────────────────────────────────────────────────────

func (h *DriverOpsHandler) HandleGetCoachingFlags(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type Flag struct {
		ID         string          `json:"id"`
		DriverID   string          `json:"driver_id"`
		TripID     *string         `json:"trip_id,omitempty"`
		FlagType   string          `json:"flag_type"`
		Severity   string          `json:"severity"`
		Details    json.RawMessage `json:"details"`
		IsResolved bool            `json:"is_resolved"`
		ResolvedAt *time.Time      `json:"resolved_at,omitempty"`
		CreatedAt  time.Time       `json:"created_at"`
	}

	onlyOpen := r.URL.Query().Get("open") == "true"
	where := ""
	if onlyOpen {
		where = "WHERE is_resolved = false"
	}

	rows, err := h.db.Query(ctx, `SELECT id, driver_id, trip_id, flag_type, severity, details, is_resolved, resolved_at, created_at FROM coaching_flags `+where+` ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Flag{}
	for rows.Next() {
		var f Flag
		if err := rows.Scan(&f.ID, &f.DriverID, &f.TripID, &f.FlagType, &f.Severity, &f.Details, &f.IsResolved, &f.ResolvedAt, &f.CreatedAt); err != nil {
			continue
		}
		result = append(result, f)
	}
	dopsJSON(w, http.StatusOK, map[string]any{"flags": result, "count": len(result)})
}

func (h *DriverOpsHandler) HandleResolveCoachingFlag(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPost) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	_, err := h.db.Exec(ctx, `UPDATE coaching_flags SET is_resolved=true, resolved_at=NOW() WHERE id=$1`, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	dopsJSON(w, http.StatusOK, map[string]string{"status": "resolved"})
}

func (h *DriverOpsHandler) HandleGetTrainingModules(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type Module struct {
		ID          string    `json:"id"`
		Title       string    `json:"title"`
		Category    string    `json:"category"`
		ContentURL  string    `json:"content_url"`
		DurationMin int       `json:"duration_mins"`
		IsMandatory bool      `json:"is_mandatory"`
		PassScore   int       `json:"pass_score"`
		IsActive    bool      `json:"is_active"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, title, category, content_url, duration_mins, is_mandatory, pass_score, is_active FROM training_modules ORDER BY is_mandatory DESC, category, title`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Module{}
	for rows.Next() {
		var m Module
		if err := rows.Scan(&m.ID, &m.Title, &m.Category, &m.ContentURL, &m.DurationMin, &m.IsMandatory, &m.PassScore, &m.IsActive); err != nil {
			continue
		}
		result = append(result, m)
	}
	dopsJSON(w, http.StatusOK, map[string]any{"modules": result})
}

// ── Vehicle Inspection ────────────────────────────────────────────────────────

func (h *DriverOpsHandler) HandleGetInspections(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type Inspection struct {
		ID           string     `json:"id"`
		DriverID     string     `json:"driver_id"`
		VehiclePlate string     `json:"vehicle_plate"`
		Status       string     `json:"status"`
		DueDate      string     `json:"due_date"`
		SubmittedAt  *time.Time `json:"submitted_at,omitempty"`
		OverallScore *int       `json:"overall_score,omitempty"`
		Notes        string     `json:"notes"`
		CreatedAt    time.Time  `json:"created_at"`
	}

	statusFilter := r.URL.Query().Get("status")
	where, args := "", []any{}
	if statusFilter != "" {
		where = "WHERE status = $1"
		args = append(args, statusFilter)
	}

	rows, err := h.db.Query(ctx, `SELECT id, driver_id, vehicle_plate, status, due_date::text, submitted_at, overall_score, notes, created_at FROM vehicle_inspections `+where+` ORDER BY due_date ASC LIMIT 100`, args...)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Inspection{}
	for rows.Next() {
		var ins Inspection
		if err := rows.Scan(&ins.ID, &ins.DriverID, &ins.VehiclePlate, &ins.Status, &ins.DueDate, &ins.SubmittedAt, &ins.OverallScore, &ins.Notes, &ins.CreatedAt); err != nil {
			continue
		}
		result = append(result, ins)
	}
	dopsJSON(w, http.StatusOK, map[string]any{"inspections": result, "count": len(result)})
}

func (h *DriverOpsHandler) HandleReviewInspection(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPatch) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	var body struct {
		Status string `json:"status"`
		Score  int    `json:"overall_score"`
		Notes  string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	_, err := h.db.Exec(ctx, `UPDATE vehicle_inspections SET status=$1, overall_score=$2, notes=$3, reviewed_at=NOW() WHERE id=$4`, body.Status, body.Score, body.Notes, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	dopsJSON(w, http.StatusOK, map[string]string{"status": body.Status})
}

// ── Telematics ────────────────────────────────────────────────────────────────

func (h *DriverOpsHandler) HandleGetTelematicsEvents(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type TelEvent struct {
		ID         string     `json:"id"`
		DriverID   string     `json:"driver_id"`
		TripID     *string    `json:"trip_id,omitempty"`
		EventType  string     `json:"event_type"`
		Severity   string     `json:"severity"`
		SpeedKmph  *float64   `json:"speed_kmph,omitempty"`
		Lat        *float64   `json:"lat,omitempty"`
		Lng        *float64   `json:"lng,omitempty"`
		OccurredAt time.Time  `json:"occurred_at"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, driver_id, trip_id, event_type, severity, speed_kmph, lat, lng, occurred_at FROM telematics_events ORDER BY occurred_at DESC LIMIT 100`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []TelEvent{}
	for rows.Next() {
		var e TelEvent
		if err := rows.Scan(&e.ID, &e.DriverID, &e.TripID, &e.EventType, &e.Severity, &e.SpeedKmph, &e.Lat, &e.Lng, &e.OccurredAt); err != nil {
			continue
		}
		result = append(result, e)
	}
	dopsJSON(w, http.StatusOK, map[string]any{"events": result, "count": len(result)})
}

func (h *DriverOpsHandler) HandleGetTelematicsSummaries(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type Summary struct {
		DriverID          string  `json:"driver_id"`
		PeriodDate        string  `json:"period_date"`
		TotalDistanceKm   float64 `json:"total_distance_km"`
		HarshBrakingCount int     `json:"harsh_braking_count"`
		SpeedingCount     int     `json:"speeding_count"`
		SharpTurnCount    int     `json:"sharp_turn_count"`
		PhoneUsageCount   int     `json:"phone_usage_count"`
		SafetyScore       int     `json:"safety_score"`
	}

	rows, err := h.db.Query(ctx, `SELECT driver_id, period_date::text, total_distance_km, harsh_braking_count, speeding_count, sharp_turn_count, phone_usage_count, safety_score FROM driver_telematics_summary ORDER BY safety_score ASC, period_date DESC LIMIT 50`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Summary{}
	for rows.Next() {
		var s Summary
		if err := rows.Scan(&s.DriverID, &s.PeriodDate, &s.TotalDistanceKm, &s.HarshBrakingCount, &s.SpeedingCount, &s.SharpTurnCount, &s.PhoneUsageCount, &s.SafetyScore); err != nil {
			continue
		}
		result = append(result, s)
	}
	dopsJSON(w, http.StatusOK, map[string]any{"summaries": result})
}
