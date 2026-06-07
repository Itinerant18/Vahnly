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

type NotificationsHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewNotificationsHandler(db *pgxpool.Pool, logger *log.Logger) *NotificationsHandler {
	return &NotificationsHandler{db: db, logger: logger}
}

type AdminNotification struct {
	ID             string          `json:"id"`
	AlertType      string          `json:"alert_type"`
	Severity       string          `json:"severity"`
	Title          string          `json:"title"`
	Body           string          `json:"body"`
	Metadata       json.RawMessage `json:"metadata"`
	Status         string          `json:"status"`
	AcknowledgedBy *string         `json:"acknowledged_by,omitempty"`
	AcknowledgedAt *time.Time      `json:"acknowledged_at,omitempty"`
	ResolvedBy     *string         `json:"resolved_by,omitempty"`
	ResolvedAt     *time.Time      `json:"resolved_at,omitempty"`
	DeliveryStatus json.RawMessage `json:"delivery_status"`
	CreatedAt      time.Time       `json:"created_at"`
}

type AlertRuleRow struct {
	ID              string     `json:"id"`
	AlertType       string     `json:"alert_type"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	Severity        string     `json:"severity"`
	IsEnabled       bool       `json:"is_enabled"`
	ThresholdValue  *float64   `json:"threshold_value"`
	ThresholdUnit   string     `json:"threshold_unit"`
	WindowMinutes   int        `json:"window_minutes"`
	CooldownMinutes int        `json:"cooldown_minutes"`
	Channels        []string   `json:"channels"`
	LastFiredAt     *time.Time `json:"last_fired_at"`
	FiredCount      int        `json:"fired_count"`
	RecipientCount  int        `json:"recipient_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type AlertRecipientRow struct {
	ID          string    `json:"id"`
	RuleID      string    `json:"rule_id"`
	Email       string    `json:"email"`
	Phone       string    `json:"phone"`
	SlackUserID string    `json:"slack_user_id"`
	CreatedAt   time.Time `json:"created_at"`
}

type ChannelConfigRow struct {
	ID        string          `json:"id"`
	Channel   string          `json:"channel"`
	Config    json.RawMessage `json:"config"`
	IsEnabled bool            `json:"is_enabled"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func notifJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// HandleGetNotifications returns the notification inbox with optional filters.
func (h *NotificationsHandler) HandleGetNotifications(w http.ResponseWriter, r *http.Request) {
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
	if v := q.Get("severity"); v != "" {
		conds = append(conds, fmt.Sprintf("severity = $%d", idx))
		args = append(args, v)
		idx++
	}
	if v := q.Get("alert_type"); v != "" {
		conds = append(conds, fmt.Sprintf("alert_type = $%d", idx))
		args = append(args, v)
		idx++
	}
	if v := q.Get("from"); v != "" {
		conds = append(conds, fmt.Sprintf("created_at >= $%d", idx))
		args = append(args, v)
		idx++
	}
	if v := q.Get("to"); v != "" {
		conds = append(conds, fmt.Sprintf("created_at <= $%d", idx))
		args = append(args, v)
		_ = idx
	}

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	sql := fmt.Sprintf(`SELECT id, alert_type, severity, title, body, metadata, status,
		acknowledged_by, acknowledged_at, resolved_by, resolved_at, delivery_status, created_at
		FROM admin_notifications %s ORDER BY created_at DESC LIMIT 200`, where)

	rows, err := h.db.Query(ctx, sql, args...)
	if err != nil {
		h.logger.Printf("GetNotifications: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []AdminNotification{}
	for rows.Next() {
		var n AdminNotification
		if err := rows.Scan(&n.ID, &n.AlertType, &n.Severity, &n.Title, &n.Body,
			&n.Metadata, &n.Status, &n.AcknowledgedBy, &n.AcknowledgedAt,
			&n.ResolvedBy, &n.ResolvedAt, &n.DeliveryStatus, &n.CreatedAt); err != nil {
			continue
		}
		result = append(result, n)
	}
	notifJSON(w, http.StatusOK, map[string]any{"notifications": result, "count": len(result)})
}

// HandleGetNotificationStats returns unread counts and firing statistics.
func (h *NotificationsHandler) HandleGetNotificationStats(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var totalUnread, criticalUnread, highUnread, mediumUnread, lowUnread, firedToday, firedWeek int
	err := h.db.QueryRow(ctx, `SELECT
		COUNT(*) FILTER (WHERE status = 'UNREAD'),
		COUNT(*) FILTER (WHERE status = 'UNREAD' AND severity = 'CRITICAL'),
		COUNT(*) FILTER (WHERE status = 'UNREAD' AND severity = 'HIGH'),
		COUNT(*) FILTER (WHERE status = 'UNREAD' AND severity = 'MEDIUM'),
		COUNT(*) FILTER (WHERE status = 'UNREAD' AND severity = 'LOW'),
		COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE),
		COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')
		FROM admin_notifications`).Scan(&totalUnread, &criticalUnread, &highUnread, &mediumUnread, &lowUnread, &firedToday, &firedWeek)
	if err != nil {
		h.logger.Printf("GetNotificationStats: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}

	var activeRules, totalRules int
	_ = h.db.QueryRow(ctx, `SELECT COUNT(*) FILTER (WHERE is_enabled), COUNT(*) FROM admin_alert_rules`).Scan(&activeRules, &totalRules)

	notifJSON(w, http.StatusOK, map[string]any{
		"total_unread":    totalUnread,
		"by_severity":     map[string]int{"CRITICAL": criticalUnread, "HIGH": highUnread, "MEDIUM": mediumUnread, "LOW": lowUnread},
		"fired_today":     firedToday,
		"fired_this_week": firedWeek,
		"active_rules":    activeRules,
		"total_rules":     totalRules,
	})
}

// HandleGetNotificationDetail returns one notification and marks it READ.
func (h *NotificationsHandler) HandleGetNotificationDetail(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	var n AdminNotification
	err := h.db.QueryRow(ctx, `SELECT id, alert_type, severity, title, body, metadata, status,
		acknowledged_by, acknowledged_at, resolved_by, resolved_at, delivery_status, created_at
		FROM admin_notifications WHERE id = $1`, id).Scan(
		&n.ID, &n.AlertType, &n.Severity, &n.Title, &n.Body,
		&n.Metadata, &n.Status, &n.AcknowledgedBy, &n.AcknowledgedAt,
		&n.ResolvedBy, &n.ResolvedAt, &n.DeliveryStatus, &n.CreatedAt)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if n.Status == "UNREAD" {
		_, _ = h.db.Exec(ctx, `UPDATE admin_notifications SET status = 'READ' WHERE id = $1`, id)
		n.Status = "READ"
	}

	notifJSON(w, http.StatusOK, n)
}

// HandleAcknowledgeNotification moves status to ACKNOWLEDGED.
func (h *NotificationsHandler) HandleAcknowledgeNotification(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	_, err := h.db.Exec(ctx, `UPDATE admin_notifications
		SET status = 'ACKNOWLEDGED', acknowledged_at = NOW()
		WHERE id = $1 AND status NOT IN ('ACKNOWLEDGED','RESOLVED')`, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	notifJSON(w, http.StatusOK, map[string]string{"status": "acknowledged"})
}

// HandleResolveNotification closes a notification.
func (h *NotificationsHandler) HandleResolveNotification(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	_, err := h.db.Exec(ctx, `UPDATE admin_notifications
		SET status = 'RESOLVED', resolved_at = NOW()
		WHERE id = $1 AND status != 'RESOLVED'`, id)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	notifJSON(w, http.StatusOK, map[string]string{"status": "resolved"})
}

// HandleBulkAcknowledge acknowledges multiple notifications at once.
func (h *NotificationsHandler) HandleBulkAcknowledge(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		http.Error(w, "ids array required", http.StatusBadRequest)
		return
	}

	tag, err := h.db.Exec(ctx, `UPDATE admin_notifications
		SET status = 'ACKNOWLEDGED', acknowledged_at = NOW()
		WHERE id = ANY($1) AND status NOT IN ('ACKNOWLEDGED','RESOLVED')`, body.IDs)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	notifJSON(w, http.StatusOK, map[string]any{"acknowledged": tag.RowsAffected()})
}

// HandleGetAlertRules lists all alert rules with recipient counts.
func (h *NotificationsHandler) HandleGetAlertRules(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	rows, err := h.db.Query(ctx, `SELECT r.id, r.alert_type, r.name, r.description, r.severity,
		r.is_enabled, r.threshold_value, r.threshold_unit, r.window_minutes, r.cooldown_minutes,
		r.channels, r.last_fired_at, r.fired_count, r.created_at, r.updated_at,
		COUNT(rc.id)::int AS recipient_count
		FROM admin_alert_rules r
		LEFT JOIN admin_alert_recipients rc ON rc.rule_id = r.id
		GROUP BY r.id ORDER BY r.alert_type`)
	if err != nil {
		h.logger.Printf("GetAlertRules: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []AlertRuleRow{}
	for rows.Next() {
		var ar AlertRuleRow
		if err := rows.Scan(&ar.ID, &ar.AlertType, &ar.Name, &ar.Description, &ar.Severity,
			&ar.IsEnabled, &ar.ThresholdValue, &ar.ThresholdUnit, &ar.WindowMinutes,
			&ar.CooldownMinutes, &ar.Channels, &ar.LastFiredAt, &ar.FiredCount,
			&ar.CreatedAt, &ar.UpdatedAt, &ar.RecipientCount); err != nil {
			continue
		}
		if ar.Channels == nil {
			ar.Channels = []string{}
		}
		result = append(result, ar)
	}
	notifJSON(w, http.StatusOK, map[string]any{"rules": result})
}

// HandleUpsertAlertRule creates (POST) or updates (PATCH /{id}) an alert rule.
func (h *NotificationsHandler) HandleUpsertAlertRule(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	var body struct {
		AlertType       string   `json:"alert_type"`
		Name            string   `json:"name"`
		Description     string   `json:"description"`
		Severity        string   `json:"severity"`
		ThresholdValue  *float64 `json:"threshold_value"`
		ThresholdUnit   string   `json:"threshold_unit"`
		WindowMinutes   int      `json:"window_minutes"`
		CooldownMinutes int      `json:"cooldown_minutes"`
		Channels        []string `json:"channels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	if id != "" {
		_, err := h.db.Exec(ctx, `UPDATE admin_alert_rules SET
			name = $1, description = $2, severity = $3, threshold_value = $4,
			threshold_unit = $5, window_minutes = $6, cooldown_minutes = $7,
			channels = $8, updated_at = NOW() WHERE id = $9`,
			body.Name, body.Description, body.Severity, body.ThresholdValue,
			body.ThresholdUnit, body.WindowMinutes, body.CooldownMinutes, body.Channels, id)
		if err != nil {
			h.logger.Printf("UpdateAlertRule: %v", err)
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		notifJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
		return
	}

	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO admin_alert_rules
		(alert_type, name, description, severity, threshold_value, threshold_unit, window_minutes, cooldown_minutes, channels)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		body.AlertType, body.Name, body.Description, body.Severity, body.ThresholdValue,
		body.ThresholdUnit, body.WindowMinutes, body.CooldownMinutes, body.Channels).Scan(&newID)
	if err != nil {
		h.logger.Printf("CreateAlertRule: %v", err)
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	notifJSON(w, http.StatusCreated, map[string]string{"id": newID, "status": "created"})
}

// HandleToggleAlertRule flips the is_enabled flag.
func (h *NotificationsHandler) HandleToggleAlertRule(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	id := r.PathValue("id")
	var isEnabled bool
	err := h.db.QueryRow(ctx, `UPDATE admin_alert_rules
		SET is_enabled = NOT is_enabled, updated_at = NOW()
		WHERE id = $1 RETURNING is_enabled`, id).Scan(&isEnabled)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	notifJSON(w, http.StatusOK, map[string]any{"id": id, "is_enabled": isEnabled})
}

// HandleGetRecipients lists recipients for a specific alert rule.
func (h *NotificationsHandler) HandleGetRecipients(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	ruleID := r.PathValue("id")
	rows, err := h.db.Query(ctx, `SELECT id, rule_id, email, phone, slack_user_id, created_at
		FROM admin_alert_recipients WHERE rule_id = $1 ORDER BY email`, ruleID)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []AlertRecipientRow{}
	for rows.Next() {
		var rec AlertRecipientRow
		if err := rows.Scan(&rec.ID, &rec.RuleID, &rec.Email, &rec.Phone, &rec.SlackUserID, &rec.CreatedAt); err != nil {
			continue
		}
		result = append(result, rec)
	}
	notifJSON(w, http.StatusOK, map[string]any{"recipients": result})
}

// HandleSetRecipients replaces the full recipient list for a rule.
func (h *NotificationsHandler) HandleSetRecipients(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	ruleID := r.PathValue("id")
	var body struct {
		Recipients []struct {
			Email       string `json:"email"`
			Phone       string `json:"phone"`
			SlackUserID string `json:"slack_user_id"`
		} `json:"recipients"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM admin_alert_recipients WHERE rule_id = $1`, ruleID); err != nil {
		http.Error(w, "delete error", http.StatusInternalServerError)
		return
	}
	for _, rec := range body.Recipients {
		if rec.Email == "" {
			continue
		}
		_, _ = tx.Exec(ctx, `INSERT INTO admin_alert_recipients (rule_id, email, phone, slack_user_id)
			VALUES ($1,$2,$3,$4) ON CONFLICT (rule_id, email) DO NOTHING`,
			ruleID, rec.Email, rec.Phone, rec.SlackUserID)
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit error", http.StatusInternalServerError)
		return
	}
	notifJSON(w, http.StatusOK, map[string]any{"rule_id": ruleID, "count": len(body.Recipients)})
}

// HandleGetChannelConfigs returns the global email/Slack/SMS channel configurations.
func (h *NotificationsHandler) HandleGetChannelConfigs(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.db.Query(ctx, `SELECT id, channel, config, is_enabled, updated_at
		FROM admin_notification_channel_configs ORDER BY channel`)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []ChannelConfigRow{}
	for rows.Next() {
		var cc ChannelConfigRow
		if err := rows.Scan(&cc.ID, &cc.Channel, &cc.Config, &cc.IsEnabled, &cc.UpdatedAt); err != nil {
			continue
		}
		result = append(result, cc)
	}
	notifJSON(w, http.StatusOK, map[string]any{"channels": result})
}

// HandleUpsertChannelConfig saves config for one delivery channel.
func (h *NotificationsHandler) HandleUpsertChannelConfig(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	channel := strings.ToUpper(r.PathValue("channel"))
	var body struct {
		Config    json.RawMessage `json:"config"`
		IsEnabled bool            `json:"is_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	_, err := h.db.Exec(ctx, `INSERT INTO admin_notification_channel_configs (channel, config, is_enabled, updated_at)
		VALUES ($1,$2,$3,NOW())
		ON CONFLICT (channel) DO UPDATE SET config = $2, is_enabled = $3, updated_at = NOW()`,
		channel, body.Config, body.IsEnabled)
	if err != nil {
		h.logger.Printf("UpsertChannelConfig: %v", err)
		http.Error(w, "upsert failed", http.StatusInternalServerError)
		return
	}
	notifJSON(w, http.StatusOK, map[string]string{"channel": channel, "status": "saved"})
}

// HandleTestChannel simulates dispatching a test message on the given channel.
func (h *NotificationsHandler) HandleTestChannel(w http.ResponseWriter, r *http.Request) {
	channel := strings.ToUpper(r.PathValue("channel"))
	messages := map[string]string{
		"EMAIL": "Test email dispatched to configured recipients (SMTP simulation)",
		"SLACK": "Test message posted to Slack channel (webhook simulation)",
		"SMS":   "Test SMS sent via configured provider (simulation)",
	}
	msg, ok := messages[channel]
	if !ok {
		http.Error(w, "unknown channel — must be EMAIL, SLACK, or SMS", http.StatusBadRequest)
		return
	}
	notifJSON(w, http.StatusOK, map[string]any{"channel": channel, "success": true, "message": msg, "simulated": true})
}

// HandleSimulateAlert inserts a fake notification for testing (SUPER_ADMIN only).
func (h *NotificationsHandler) HandleSimulateAlert(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		AlertType string `json:"alert_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.AlertType == "" {
		http.Error(w, "alert_type required", http.StatusBadRequest)
		return
	}

	titles := map[string]string{
		"SOS":               "SOS Alert (Simulated): Trip #TEST-001 — Test Location",
		"HIGH_CANCELLATION": "High Cancellation Rate (Simulated): 22% in last 15 min",
		"SURGE_CAP":         "Surge Cap Hit (Simulated): 3.0× in Test City",
		"PAYMENT_GW_DOWN":   "Payment Gateway Down (Simulated): 3 consecutive failures",
		"KYC_BACKLOG_SLA":   "KYC Backlog SLA Breach (Simulated): 52 pending docs",
		"PAYOUT_FAILURE":    "Payout Failure (Simulated): 6 failed in test batch",
	}
	severities := map[string]string{
		"SOS": "CRITICAL", "PAYMENT_GW_DOWN": "CRITICAL",
		"HIGH_CANCELLATION": "HIGH", "KYC_BACKLOG_SLA": "HIGH", "PAYOUT_FAILURE": "HIGH",
		"SURGE_CAP": "MEDIUM",
	}

	title := titles[body.AlertType]
	if title == "" {
		title = fmt.Sprintf("Simulated Alert: %s", body.AlertType)
	}
	severity := severities[body.AlertType]
	if severity == "" {
		severity = "MEDIUM"
	}

	var id string
	err := h.db.QueryRow(ctx, `INSERT INTO admin_notifications
		(alert_type, severity, title, body, metadata, delivery_status)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		body.AlertType, severity, title,
		"This is a simulated alert generated for testing purposes. No real action required.",
		json.RawMessage(`{"simulated":true}`),
		json.RawMessage(`{"email":"SIMULATED","slack":"SIMULATED"}`)).Scan(&id)
	if err != nil {
		h.logger.Printf("SimulateAlert: %v", err)
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}

	_, _ = h.db.Exec(ctx, `UPDATE admin_alert_rules
		SET last_fired_at = NOW(), fired_count = fired_count + 1, updated_at = NOW()
		WHERE alert_type = $1`, body.AlertType)

	notifJSON(w, http.StatusCreated, map[string]any{"id": id, "simulated": true, "alert_type": body.AlertType})
}
