package http

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SafetyHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewSafetyHandler(dbPool *pgxpool.Pool, logger *log.Logger) *SafetyHandler {
	return &SafetyHandler{dbPool: dbPool, logger: logger}
}

type SOSAlert struct {
	ID                        string     `json:"id"`
	TripID                    string     `json:"trip_id"`
	ReporterType              string     `json:"reporter_type"`
	Status                    string     `json:"status"`
	AssignedAgentID           *string    `json:"assigned_agent_id"`
	AssignedAgentName         *string    `json:"assigned_agent_name"`
	AudioStreamURL            *string    `json:"audio_stream_url"`
	Latitude                  *float64   `json:"latitude"`
	Longitude                 *float64   `json:"longitude"`
	EmergencyContactsNotified bool       `json:"emergency_contacts_notified"`
	AuthoritiesDispatched     bool       `json:"authorities_dispatched"`
	Notes                     *string    `json:"notes"`
	CreatedAt                 time.Time  `json:"created_at"`
	UpdatedAt                 time.Time  `json:"updated_at"`
	ResolvedAt                *time.Time `json:"resolved_at"`
}

type SafetyIncident struct {
	ID                      string     `json:"id"`
	SOSAlertID              *string    `json:"sos_alert_id"`
	TripID                  string     `json:"trip_id"`
	Category                string     `json:"category"`
	ReporterID              string     `json:"reporter_id"`
	ReporterType            string     `json:"reporter_type"`
	Description             string     `json:"description"`
	Status                  string     `json:"status"`
	EvidenceURLs            []string   `json:"evidence_urls"`
	OutcomeType             *string    `json:"outcome_type"`
	OutcomeDetails          *string    `json:"outcome_details"`
	D4MCareClaimID          *string    `json:"d4m_care_claim_id"`
	D4MCareClaimStatus      string     `json:"d4m_care_claim_status"`
	D4MCareClaimAmountPaise int64      `json:"d4m_care_claim_amount_paise"`
	AssignedAgentID         *string    `json:"assigned_agent_id"`
	AssignedAgentName       *string    `json:"assigned_agent_name"`
	CreatedAt               time.Time  `json:"created_at"`
	UpdatedAt               time.Time  `json:"updated_at"`
	ResolvedAt              *time.Time `json:"resolved_at"`
}

type RideCheckAnomaly struct {
	ID          int       `json:"id"`
	TripID      string    `json:"trip_id"`
	AnomalyType string    `json:"anomaly_type"`
	Description string    `json:"description"`
	Severity    string    `json:"severity"`
	Latitude    *float64  `json:"latitude"`
	Longitude   *float64  `json:"longitude"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

type BlacklistEntry struct {
	ID             int       `json:"id"`
	UserID         string    `json:"user_id"`
	UserType       string    `json:"user_type"`
	BlockType      string    `json:"block_type"`
	TargetUserID   *string   `json:"target_user_id"`
	TargetUserType *string   `json:"target_user_type"`
	Reason         string    `json:"reason"`
	CreatedAt      time.Time `json:"created_at"`
	CreatedBy      *string   `json:"created_by"`
	CreatedByName  *string   `json:"created_by_name"`
}

// HandleGetSOSAlerts lists SOS alerts
func (h *SafetyHandler) HandleGetSOSAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	status := q.Get("status")

	query := `
		SELECT 
			s.id, s.trip_id, s.reporter_type, s.status, s.assigned_agent_id, a.full_name,
			s.audio_stream_url, s.latitude, s.longitude, s.emergency_contacts_notified,
			s.authorities_dispatched, s.notes, s.created_at, s.updated_at, s.resolved_at
		FROM safety_sos_alerts s
		LEFT JOIN system_admins a ON a.id = s.assigned_agent_id
		WHERE 1=1
	`
	var args []interface{}
	argIdx := 1

	if status != "" {
		query += fmt.Sprintf(" AND s.status = $%d", argIdx)
		args = append(args, strings.ToUpper(status))
		argIdx++
	}

	query += " ORDER BY s.created_at DESC"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed querying SOS alerts: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	alerts := make([]SOSAlert, 0)
	for rows.Next() {
		var item SOSAlert
		var agentID, agentName, audio, notes sql.NullString
		var lat, lng sql.NullFloat64
		var resAt sql.NullTime
		err := rows.Scan(
			&item.ID, &item.TripID, &item.ReporterType, &item.Status, &agentID, &agentName,
			&audio, &lat, &lng, &item.EmergencyContactsNotified, &item.AuthoritiesDispatched,
			&notes, &item.CreatedAt, &item.UpdatedAt, &resAt,
		)
		if err == nil {
			if agentID.Valid { item.AssignedAgentID = &agentID.String }
			if agentName.Valid { item.AssignedAgentName = &agentName.String }
			if audio.Valid { item.AudioStreamURL = &audio.String }
			if notes.Valid { item.Notes = &notes.String }
			if lat.Valid { item.Latitude = &lat.Float64 }
			if lng.Valid { item.Longitude = &lng.Float64 }
			if resAt.Valid { item.ResolvedAt = &resAt.Time }
			alerts = append(alerts, item)
		} else {
			h.logger.Printf("[SAFETY_ERROR] SOS row scan failed: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(alerts)
}

// HandleCreateSOSAlert manually triggers an SOS alert (useful for simulation)
func (h *SafetyHandler) HandleCreateSOSAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TripID       string  `json:"trip_id"`
		ReporterType string  `json:"reporter_type"` // RIDER, DRIVER
		Latitude     float64 `json:"latitude"`
		Longitude    float64 `json:"longitude"`
		Notes        string  `json:"notes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TripID == "" || req.ReporterType == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	sosID := fmt.Sprintf("SOS-%d", (time.Now().UnixNano()/1000)%100000)

	audio := "https://platform-safety-recordings.s3.amazonaws.com/sos/" + sosID + ".mp3"

	query := `
		INSERT INTO safety_sos_alerts (id, trip_id, reporter_type, status, audio_stream_url, latitude, longitude, notes)
		VALUES ($1, $2::uuid, $3, 'ACTIVE', $4, $5, $6, $7)
	`
	_, err := h.dbPool.Exec(ctx, query, sosID, req.TripID, strings.ToUpper(req.ReporterType), audio, req.Latitude, req.Longitude, req.Notes)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed inserting manual SOS: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":"%s"}`, sosID)))
}

// HandleAcknowledgeSOSAlert locks SOS alert to support agent
func (h *SafetyHandler) HandleAcknowledgeSOSAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_sos_id", http.StatusBadRequest)
		return
	}

	var req struct {
		AgentID string `json:"agent_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	agentID := req.AgentID
	if agentID == "" {
		agentID = r.Header.Get("X-Admin-ID")
	}
	if agentID == "" {
		// Default system/super admin fallback
		agentID = "255e9024-d123-4063-9c6f-1662b7f2e8a5" 
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := "UPDATE safety_sos_alerts SET status = 'ACKNOWLEDGED', assigned_agent_id = $1::uuid, updated_at = NOW() WHERE id = $2"
	_, err := h.dbPool.Exec(ctx, query, agentID, id)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed acknowledging SOS: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	// Notify the assigned driver that safety has the SOS in hand (FLOW 5 step 5).
	// Resolve the driver from the alert's trip and enqueue an outbox push. Best-effort.
	var driverID *string
	_ = h.dbPool.QueryRow(ctx, `
		SELECT o.assigned_driver_id::text FROM safety_sos_alerts s
		JOIN orders o ON o.id = s.trip_id WHERE s.id = $1`, id).Scan(&driverID)
	if driverID != nil && *driverID != "" {
		_, _ = h.dbPool.Exec(ctx, `
			INSERT INTO driver_notifications (driver_id, category, title, body)
			VALUES ($1::uuid, 'SAFETY', $2, $3)`,
			*driverID, "Safety team notified", "An SOS on your trip is being handled by our safety team. Stay calm and follow their guidance.")
		_, _ = h.dbPool.Exec(ctx, `
			INSERT INTO notification_outbox (user_id, title, body, payload, status)
			VALUES ($1::uuid, $2, $3, $4::jsonb, 'PENDING')`,
			*driverID, "Safety team notified", "An SOS on your trip is being handled by our safety team.",
			`{"type":"SOS_ACKNOWLEDGED"}`)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleResolveSOSAlert resolves active SOS alert
func (h *SafetyHandler) HandleResolveSOSAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_sos_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := "UPDATE safety_sos_alerts SET status = 'RESOLVED', notes = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2"
	_, err := h.dbPool.Exec(ctx, query, req.Notes, id)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed resolving SOS: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleExecuteSOSAction performs specific response actions (calling, dispatch authorities)
func (h *SafetyHandler) HandleExecuteSOSAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_sos_id", http.StatusBadRequest)
		return
	}

	var req struct {
		ActionType string `json:"action_type"` // "DIAL_RIDER", "DIAL_DRIVER", "DISPATCH_AUTHORITIES", "NOTIFY_CONTACTS"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ActionType == "" {
		http.Error(w, "invalid_action_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var query string
	switch req.ActionType {
	case "DISPATCH_AUTHORITIES":
		query = "UPDATE safety_sos_alerts SET authorities_dispatched = true, updated_at = NOW() WHERE id = $1"
	case "NOTIFY_CONTACTS":
		query = "UPDATE safety_sos_alerts SET emergency_contacts_notified = true, updated_at = NOW() WHERE id = $1"
	default:
		// Phone calls are just mocked logs
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"SUCCESS","message":"Mock call dialed: %s"}`, req.ActionType)))
		return
	}

	_, err := h.dbPool.Exec(ctx, query, id)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed updating SOS action: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleGetIncidents lists post-trip safety incidents
func (h *SafetyHandler) HandleGetIncidents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	category := q.Get("category")
	status := q.Get("status")

	query := `
		SELECT 
			i.id, i.sos_alert_id, i.trip_id, i.category, i.reporter_id, i.reporter_type,
			i.description, i.status, i.evidence_urls, i.outcome_type, i.outcome_details,
			i.d4m_care_claim_id, i.d4m_care_claim_status, i.d4m_care_claim_amount_paise,
			i.assigned_agent_id, a.full_name, i.created_at, i.updated_at, i.resolved_at
		FROM safety_incidents i
		LEFT JOIN system_admins a ON a.id = i.assigned_agent_id
		WHERE 1=1
	`
	var args []interface{}
	argIdx := 1

	if category != "" {
		query += fmt.Sprintf(" AND i.category = $%d", argIdx)
		args = append(args, strings.ToUpper(category))
		argIdx++
	}
	if status != "" {
		query += fmt.Sprintf(" AND i.status = $%d", argIdx)
		args = append(args, strings.ToUpper(status))
		argIdx++
	}

	query += " ORDER BY i.created_at DESC"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed querying incidents: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	incidents := make([]SafetyIncident, 0)
	for rows.Next() {
		var item SafetyIncident
		var sosAlert, outcome, details, claim, agentID, agentName sql.NullString
		var resTime sql.NullTime
		err := rows.Scan(
			&item.ID, &sosAlert, &item.TripID, &item.Category, &item.ReporterID, &item.ReporterType,
			&item.Description, &item.Status, &item.EvidenceURLs, &outcome, &details,
			&claim, &item.D4MCareClaimStatus, &item.D4MCareClaimAmountPaise,
			&agentID, &agentName, &item.CreatedAt, &item.UpdatedAt, &resTime,
		)
		if err == nil {
			if sosAlert.Valid { item.SOSAlertID = &sosAlert.String }
			if outcome.Valid { item.OutcomeType = &outcome.String }
			if details.Valid { item.OutcomeDetails = &details.String }
			if claim.Valid { item.D4MCareClaimID = &claim.String }
			if agentID.Valid { item.AssignedAgentID = &agentID.String }
			if agentName.Valid { item.AssignedAgentName = &agentName.String }
			if resTime.Valid { item.ResolvedAt = &resTime.Time }
			incidents = append(incidents, item)
		} else {
			h.logger.Printf("[SAFETY_ERROR] Incident row scan failed: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(incidents)
}

// HandleCreateIncident creates a new safety incident report
func (h *SafetyHandler) HandleCreateIncident(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SOSAlertID   *string  `json:"sos_alert_id"`
		TripID       string   `json:"trip_id"`
		Category     string   `json:"category"` // ACCIDENT, HARASSMENT, THEFT, RASH_DRIVING, VEHICLE_ISSUE, OTHER
		ReporterID   string   `json:"reporter_id"`
		ReporterType string   `json:"reporter_type"` // RIDER, DRIVER, SYSTEM
		Description  string   `json:"description"`
		EvidenceURLs []string `json:"evidence_urls"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TripID == "" || req.Category == "" || req.ReporterID == "" || req.Description == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	incID := fmt.Sprintf("INC-%d", (time.Now().UnixNano()/1000)%100000)
	evidence := req.EvidenceURLs
	if evidence == nil {
		evidence = []string{}
	}

	query := `
		INSERT INTO safety_incidents (id, sos_alert_id, trip_id, category, reporter_id, reporter_type, description, status, evidence_urls)
		VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6, $7, 'OPEN', $8)
	`
	_, err := h.dbPool.Exec(ctx, query, incID, req.SOSAlertID, req.TripID, strings.ToUpper(req.Category), req.ReporterID, strings.ToUpper(req.ReporterType), req.Description, evidence)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed inserting incident: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"id":"%s"}`, incID)))
}

// HandleGetIncidentDetail fetches details of a single incident
func (h *SafetyHandler) HandleGetIncidentDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_incident_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var item SafetyIncident
	var sosAlert, outcome, details, claim, agentID, agentName sql.NullString
	var resTime sql.NullTime

	query := `
		SELECT 
			i.id, i.sos_alert_id, i.trip_id, i.category, i.reporter_id, i.reporter_type,
			i.description, i.status, i.evidence_urls, i.outcome_type, i.outcome_details,
			i.d4m_care_claim_id, i.d4m_care_claim_status, i.d4m_care_claim_amount_paise,
			i.assigned_agent_id, a.full_name, i.created_at, i.updated_at, i.resolved_at
		FROM safety_incidents i
		LEFT JOIN system_admins a ON a.id = i.assigned_agent_id
		WHERE i.id = $1
	`
	err := h.dbPool.QueryRow(ctx, query, id).Scan(
		&item.ID, &sosAlert, &item.TripID, &item.Category, &item.ReporterID, &item.ReporterType,
		&item.Description, &item.Status, &item.EvidenceURLs, &outcome, &details,
		&claim, &item.D4MCareClaimStatus, &item.D4MCareClaimAmountPaise,
		&agentID, &agentName, &item.CreatedAt, &item.UpdatedAt, &resTime,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "incident_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if sosAlert.Valid { item.SOSAlertID = &sosAlert.String }
	if outcome.Valid { item.OutcomeType = &outcome.String }
	if details.Valid { item.OutcomeDetails = &details.String }
	if claim.Valid { item.D4MCareClaimID = &claim.String }
	if agentID.Valid { item.AssignedAgentID = &agentID.String }
	if agentName.Valid { item.AssignedAgentName = &agentName.String }
	if resTime.Valid { item.ResolvedAt = &resTime.Time }

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(item)
}

// HandleResolveIncidentOutcome resolves incident and enforces outcomes (like Banning user)
func (h *SafetyHandler) HandleResolveIncidentOutcome(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_incident_id", http.StatusBadRequest)
		return
	}

	var req struct {
		OutcomeType    string `json:"outcome_type"` // WARNING, SUSPENSION, BAN, POLICE_CASE, INSURANCE_CLAIM, NO_ACTION
		OutcomeDetails string `json:"outcome_details"`
		AgentID        string `json:"agent_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OutcomeType == "" {
		http.Error(w, "invalid_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Fetch trip and reporter info to check who to ban
	var tripID, reporterID string
	var category, reporterType string
	err = tx.QueryRow(ctx, "SELECT trip_id, reporter_id, reporter_type, category FROM safety_incidents WHERE id = $1 FOR UPDATE", id).Scan(&tripID, &reporterID, &reporterType, &category)
	if err != nil {
		http.Error(w, "incident_not_found", http.StatusNotFound)
		return
	}

	// Update outcome
	query := `
		UPDATE safety_incidents 
		SET status = 'RESOLVED', outcome_type = $1, outcome_details = $2, resolved_at = NOW(), updated_at = NOW() 
		WHERE id = $3
	`
	_, err = tx.Exec(ctx, query, strings.ToUpper(req.OutcomeType), req.OutcomeDetails, id)
	if err != nil {
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	// If BAN outcome type, fetch rider or driver details and insert into safety_blacklist
	if strings.ToUpper(req.OutcomeType) == "BAN" {
		// Determine block target
		// Usually if a Rider files an incident about driver behavior/harassment/etc., we ban the DRIVER.
		// If Driver files, we ban the RIDER. If category is ACCIDENT or VEHICLE_ISSUE, we might ban driver or no one.
		// Let's assume we ban the other participant of the trip.
		var driverID, customerID string
		err = tx.QueryRow(ctx, "SELECT assigned_driver_id, customer_id FROM orders WHERE id = $1", tripID).Scan(&driverID, &customerID)
		if err == nil {
			var banTargetID string
			var banTargetType string
			if reporterType == "RIDER" {
				banTargetID = driverID
				banTargetType = "DRIVER"
			} else {
				banTargetID = customerID
				banTargetType = "RIDER"
			}

			if banTargetID != "" {
				// Insert into safety_blacklist
				blacklistQuery := `
					INSERT INTO safety_blacklist (user_id, user_type, block_type, reason, created_by)
					VALUES ($1::uuid, $2, 'GLOBAL', $3, $4::uuid)
				`
				agentID := req.AgentID
				if agentID == "" {
					agentID = "255e9024-d123-4063-9c6f-1662b7f2e8a5"
				}
				banReason := fmt.Sprintf("Automatically banned following safety incident investigation outcome (%s). Details: %s", id, req.OutcomeDetails)
				_, err = tx.Exec(ctx, blacklistQuery, banTargetID, banTargetType, banReason, agentID)
				if err != nil {
					h.logger.Printf("[SAFETY_ERROR] Failed registering blacklist block: %v", err)
				}
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleProcessD4MCareClaim files or updates D4M Care insurance claims
func (h *SafetyHandler) HandleProcessD4MCareClaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_incident_id", http.StatusBadRequest)
		return
	}

	var req struct {
		ClaimStatus string `json:"claim_status"` // FILED, UNDER_REVIEW, APPROVED, REJECTED
		ClaimAmount int64  `json:"claim_amount_paise"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ClaimStatus == "" {
		http.Error(w, "invalid_claim_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	claimID := fmt.Sprintf("CLM-%d", (time.Now().UnixNano()/1000)%100000)

	query := `
		UPDATE safety_incidents 
		SET d4m_care_claim_id = COALESCE(d4m_care_claim_id, $1), 
			d4m_care_claim_status = $2, 
			d4m_care_claim_amount_paise = $3,
			updated_at = NOW() 
		WHERE id = $4
	`
	_, err := h.dbPool.Exec(ctx, query, claimID, strings.ToUpper(req.ClaimStatus), req.ClaimAmount, id)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed processing claim: %v", err)
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleGetAnomalies lists flagged ride checks
func (h *SafetyHandler) HandleGetAnomalies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	status := q.Get("status")

	query := `
		SELECT id, trip_id, anomaly_type, description, severity, latitude, longitude, status, created_at
		FROM ride_check_anomalies
		WHERE 1=1
	`
	var args []interface{}
	argIdx := 1

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, strings.ToUpper(status))
		argIdx++
	}

	query += " ORDER BY created_at DESC"

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed querying anomalies: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	anomalies := make([]RideCheckAnomaly, 0)
	for rows.Next() {
		var item RideCheckAnomaly
		var lat, lng sql.NullFloat64
		err := rows.Scan(
			&item.ID, &item.TripID, &item.AnomalyType, &item.Description, &item.Severity,
			&lat, &lng, &item.Status, &item.CreatedAt,
		)
		if err == nil {
			if lat.Valid { item.Latitude = &lat.Float64 }
			if lng.Valid { item.Longitude = &lng.Float64 }
			anomalies = append(anomalies, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(anomalies)
}

// HandleResolveAnomaly resolves anomaly (dismisses or escalates)
func (h *SafetyHandler) HandleResolveAnomaly(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_anomaly_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Action string `json:"action"` // "DISMISS" or "ESCALATE_TO_SOS"
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Action == "" {
		http.Error(w, "invalid_anomaly_action", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Fetch anomaly details
	var tripID, anomalyType, description string
	var latVal, lngVal sql.NullFloat64
	err = tx.QueryRow(ctx, "SELECT trip_id, anomaly_type, description, latitude, longitude FROM ride_check_anomalies WHERE id = $1 FOR UPDATE", id).Scan(&tripID, &anomalyType, &description, &latVal, &lngVal)
	if err != nil {
		http.Error(w, "anomaly_not_found", http.StatusNotFound)
		return
	}

	status := "DISMISSED"
	if req.Action == "ESCALATE_TO_SOS" {
		status = "ESCALATED_TO_SOS"

		// Trigger active SOS alert!
		sosID := fmt.Sprintf("SOS-%d", (time.Now().UnixNano()/1000)%100000)
		audio := "https://platform-safety-recordings.s3.amazonaws.com/sos/" + sosID + ".mp3"
		var lat, lng float64
		if latVal.Valid { lat = latVal.Float64 }
		if lngVal.Valid { lng = lngVal.Float64 }
		notes := fmt.Sprintf("Automatically escalated from Ride Check Anomaly %s (%s): %s", anomalyType, id, description)

		sosQuery := `
			INSERT INTO safety_sos_alerts (id, trip_id, reporter_type, status, audio_stream_url, latitude, longitude, notes)
			VALUES ($1, $2::uuid, 'SYSTEM', 'ACTIVE', $3, $4, $5, $6)
		`
		_, err = tx.Exec(ctx, sosQuery, sosID, tripID, audio, lat, lng, notes)
		if err != nil {
			h.logger.Printf("[SAFETY_ERROR] Failed escalating anomaly to SOS: %v", err)
			http.Error(w, "database_insert_failed", http.StatusInternalServerError)
			return
		}
	}

	_, err = tx.Exec(ctx, "UPDATE ride_check_anomalies SET status = $1 WHERE id = $2", status, id)
	if err != nil {
		http.Error(w, "database_update_failed", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleGetBlacklist lists blocked entities
func (h *SafetyHandler) HandleGetBlacklist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT 
			b.id, b.user_id, b.user_type, b.block_type, b.target_user_id, b.target_user_type,
			b.reason, b.created_at, b.created_by, a.full_name
		FROM safety_blacklist b
		LEFT JOIN system_admins a ON a.id = b.created_by
		ORDER BY b.created_at DESC
	`

	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed querying blacklist: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := make([]BlacklistEntry, 0)
	for rows.Next() {
		var item BlacklistEntry
		var targetID, targetType, createdBy, creatorName sql.NullString
		err := rows.Scan(
			&item.ID, &item.UserID, &item.UserType, &item.BlockType, &targetID, &targetType,
			&item.Reason, &item.CreatedAt, &createdBy, &creatorName,
		)
		if err == nil {
			if targetID.Valid { item.TargetUserID = &targetID.String }
			if targetType.Valid { item.TargetUserType = &targetType.String }
			if createdBy.Valid { item.CreatedBy = &createdBy.String }
			if creatorName.Valid { item.CreatedByName = &creatorName.String }
			entries = append(entries, item)
		} else {
			h.logger.Printf("[SAFETY_ERROR] Blacklist row scan failed: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(entries)
}

// HandleAddBlacklistBlock registers a block
func (h *SafetyHandler) HandleAddBlacklistBlock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UserID         string  `json:"user_id"`
		UserType       string  `json:"user_type"` // RIDER, DRIVER
		BlockType      string  `json:"block_type"` // GLOBAL, MUTUAL
		TargetUserID   *string `json:"target_user_id"`
		TargetUserType *string `json:"target_user_type"`
		Reason         string  `json:"reason"`
		CreatedBy      string  `json:"created_by"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" || req.UserType == "" || req.BlockType == "" || req.Reason == "" {
		http.Error(w, "invalid_blacklist_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	createdBy := req.CreatedBy
	if createdBy == "" {
		createdBy = r.Header.Get("X-Admin-ID")
	}
	if createdBy == "" {
		createdBy = "255e9024-d123-4063-9c6f-1662b7f2e8a5"
	}
	// user_id and created_by are cast to uuid in the INSERT — validate up front so a
	// malformed value is a 400, not a 500 from the database.
	if _, err := uuid.Parse(req.UserID); err != nil {
		http.Error(w, "invalid_user_id_uuid", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(createdBy); err != nil {
		http.Error(w, "invalid_created_by_uuid", http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO safety_blacklist (user_id, user_type, block_type, target_user_id, target_user_type, reason, created_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
	`
	_, err := h.dbPool.Exec(ctx, query, req.UserID, strings.ToUpper(req.UserType), strings.ToUpper(req.BlockType), req.TargetUserID, req.TargetUserType, req.Reason, createdBy)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed inserting blacklist entry: %v", err)
		http.Error(w, "database_insert_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}

// HandleRemoveBlacklistBlock unblocks rider/driver
func (h *SafetyHandler) HandleRemoveBlacklistBlock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_blacklist_entry_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := "DELETE FROM safety_blacklist WHERE id = $1"
	_, err := h.dbPool.Exec(ctx, query, id)
	if err != nil {
		h.logger.Printf("[SAFETY_ERROR] Failed deleting blacklist entry: %v", err)
		http.Error(w, "database_delete_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"SUCCESS"}`))
}
