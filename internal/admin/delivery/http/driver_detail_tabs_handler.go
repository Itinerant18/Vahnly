package http

import (
	"context"
	"net/http"
	"time"
)

// Driver detail-tab read endpoints, all scoped by the {id} driver path value. As with
// the rider tabs, every query is best-effort and returns an empty array with HTTP 200
// when the underlying table is missing or errors. Money values are paise (bigint).
//
// Note: the driver_* tables in this codebase use mixed driver_id column types — some
// are UUID (driver_wallet_transactions, payout_requests, incentive_offers,
// driver_notifications, driver_sos_alerts) and some are VARCHAR (driver_training,
// driver_telematics_summary). Each query casts the bound id accordingly.

func (h *AdminExtrasHandler) driverTabSetup(w http.ResponseWriter, r *http.Request) (string, context.Context, context.CancelFunc, bool) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return "", nil, nil, false
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_driver_id", http.StatusBadRequest)
		return "", nil, nil, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	return id, ctx, cancel, true
}

// GET /api/v1/admin/drivers/{id}/earnings  (driver_wallet_transactions ledger)
func (h *AdminExtrasHandler) HandleDriverEarnings(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type entry struct {
		ID          string    `json:"id"`
		AmountPaise int64     `json:"amount_paise"`
		EntryType   string    `json:"entry_type"`
		Description string    `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}
	entries := make([]entry, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, amount_paise, entry_type, description, created_at
		FROM driver_wallet_transactions WHERE driver_id = $1::uuid
		ORDER BY created_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var e entry
			if err := rows.Scan(&e.ID, &e.AmountPaise, &e.EntryType, &e.Description, &e.CreatedAt); err == nil {
				entries = append(entries, e)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, entries)
}

// GET /api/v1/admin/drivers/{id}/payouts  (payout_requests)
func (h *AdminExtrasHandler) HandleDriverPayouts(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type payout struct {
		ID             string    `json:"id"`
		AmountPaise    int64     `json:"amount_paise"`
		NetAmountPaise int64     `json:"net_amount_paise"`
		Status         string    `json:"status"`
		FailureReason  string    `json:"failure_reason"`
		CreatedAt      time.Time `json:"created_at"`
	}
	payouts := make([]payout, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id, amount_paise, net_amount_paise, status,
		       COALESCE(failure_reason, ''), created_at
		FROM payout_requests WHERE driver_id = $1::uuid
		ORDER BY created_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var p payout
			if err := rows.Scan(&p.ID, &p.AmountPaise, &p.NetAmountPaise, &p.Status,
				&p.FailureReason, &p.CreatedAt); err == nil {
				payouts = append(payouts, p)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, payouts)
}

// GET /api/v1/admin/drivers/{id}/incentives  (incentive_offers joined to campaigns)
func (h *AdminExtrasHandler) HandleDriverIncentives(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type offer struct {
		ID           string     `json:"id"`
		CampaignName string     `json:"campaign_name"`
		Status       string     `json:"status"`
		OfferedAt    time.Time  `json:"offered_at"`
		ClaimedAt    *time.Time `json:"claimed_at"`
	}
	offers := make([]offer, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT io.id::text, COALESCE(c.name, ''), io.status, io.offered_at, io.claimed_at
		FROM incentive_offers io
		LEFT JOIN incentive_campaigns c ON c.id = io.campaign_id
		WHERE io.driver_id = $1::uuid
		ORDER BY io.offered_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var o offer
			if err := rows.Scan(&o.ID, &o.CampaignName, &o.Status, &o.OfferedAt, &o.ClaimedAt); err == nil {
				offers = append(offers, o)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, offers)
}

// GET /api/v1/admin/drivers/{id}/training  (driver_training joined to modules)
func (h *AdminExtrasHandler) HandleDriverTraining(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type training struct {
		ID          string     `json:"id"`
		ModuleTitle string     `json:"module_title"`
		Status      string     `json:"status"`
		Score       *int       `json:"score"`
		AssignedAt  time.Time  `json:"assigned_at"`
		CompletedAt *time.Time `json:"completed_at"`
	}
	items := make([]training, 0)
	// driver_training.driver_id is VARCHAR — compare as text.
	if rows, err := h.dbPool.Query(ctx, `
		SELECT dt.id::text, COALESCE(m.title, ''), dt.status, dt.score, dt.assigned_at, dt.completed_at
		FROM driver_training dt
		LEFT JOIN training_modules m ON m.id = dt.module_id
		WHERE dt.driver_id = $1
		ORDER BY dt.assigned_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var t training
			if err := rows.Scan(&t.ID, &t.ModuleTitle, &t.Status, &t.Score, &t.AssignedAt, &t.CompletedAt); err == nil {
				items = append(items, t)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, items)
}

// GET /api/v1/admin/drivers/{id}/performance  (driver_telematics_summary)
func (h *AdminExtrasHandler) HandleDriverPerformance(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type perf struct {
		PeriodDate        time.Time `json:"period_date"`
		TotalDistanceKm   float64   `json:"total_distance_km"`
		HarshBrakingCount int       `json:"harsh_braking_count"`
		SpeedingCount     int       `json:"speeding_count"`
		SharpTurnCount    int       `json:"sharp_turn_count"`
		PhoneUsageCount   int       `json:"phone_usage_count"`
		SafetyScore       int       `json:"safety_score"`
	}
	rowsOut := make([]perf, 0)
	// driver_telematics_summary.driver_id is VARCHAR — compare as text.
	if rows, err := h.dbPool.Query(ctx, `
		SELECT period_date, total_distance_km, harsh_braking_count, speeding_count,
		       sharp_turn_count, phone_usage_count, safety_score
		FROM driver_telematics_summary WHERE driver_id = $1
		ORDER BY period_date DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var p perf
			if err := rows.Scan(&p.PeriodDate, &p.TotalDistanceKm, &p.HarshBrakingCount, &p.SpeedingCount,
				&p.SharpTurnCount, &p.PhoneUsageCount, &p.SafetyScore); err == nil {
				rowsOut = append(rowsOut, p)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, rowsOut)
}

// GET /api/v1/admin/drivers/{id}/notifications  (driver_notifications)
func (h *AdminExtrasHandler) HandleDriverNotifications(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type notif struct {
		ID          string    `json:"id"`
		Category    string    `json:"category"`
		Title       string    `json:"title"`
		Body        string    `json:"body"`
		IsRead      bool      `json:"is_read"`
		DeliveredAt time.Time `json:"delivered_at"`
	}
	notifs := make([]notif, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, category, title, body, COALESCE(is_read, false), delivered_at
		FROM driver_notifications WHERE driver_id = $1::uuid
		ORDER BY delivered_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var n notif
			if err := rows.Scan(&n.ID, &n.Category, &n.Title, &n.Body, &n.IsRead, &n.DeliveredAt); err == nil {
				notifs = append(notifs, n)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, notifs)
}

// GET /api/v1/admin/drivers/{id}/audit  (admin_audit_logs referencing this driver)
func (h *AdminExtrasHandler) HandleDriverAudit(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type entry struct {
		ID         string    `json:"id"`
		AdminEmail string    `json:"admin_email"`
		Action     string    `json:"action"`
		Details    string    `json:"details"`
		CreatedAt  time.Time `json:"created_at"`
	}
	entries := make([]entry, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, admin_email, action, COALESCE(details, ''), created_at
		FROM admin_audit_logs
		WHERE details ILIKE '%' || $1 || '%'
		ORDER BY created_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var e entry
			if err := rows.Scan(&e.ID, &e.AdminEmail, &e.Action, &e.Details, &e.CreatedAt); err == nil {
				entries = append(entries, e)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, entries)
}

// GET /api/v1/admin/drivers/{id}/safety  (driver_sos_alerts)
func (h *AdminExtrasHandler) HandleDriverSafety(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type sos struct {
		ID         string     `json:"id"`
		OrderID    string     `json:"order_id"`
		Latitude   float64    `json:"latitude"`
		Longitude  float64    `json:"longitude"`
		AdminNotes string     `json:"admin_notes"`
		ResolvedAt *time.Time `json:"resolved_at"`
		CreatedAt  time.Time  `json:"created_at"`
	}
	alerts := make([]sos, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, COALESCE(current_order_id::text, ''), latitude, longitude,
		       COALESCE(admin_notes, ''), resolved_at, created_at
		FROM driver_sos_alerts WHERE driver_id = $1::uuid
		ORDER BY created_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var s sos
			if err := rows.Scan(&s.ID, &s.OrderID, &s.Latitude, &s.Longitude,
				&s.AdminNotes, &s.ResolvedAt, &s.CreatedAt); err == nil {
				alerts = append(alerts, s)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, alerts)
}

// GET /api/v1/admin/drivers/{id}/support  (support_tickets created by this driver)
func (h *AdminExtrasHandler) HandleDriverSupport(w http.ResponseWriter, r *http.Request) {
	id, ctx, cancel, ok := h.driverTabSetup(w, r)
	if !ok {
		return
	}
	defer cancel()

	type ticket struct {
		ID        string    `json:"id"`
		Subject   string    `json:"subject"`
		Status    string    `json:"status"`
		Priority  string    `json:"priority"`
		Category  string    `json:"category"`
		CreatedAt time.Time `json:"created_at"`
	}
	tickets := make([]ticket, 0)
	if rows, err := h.dbPool.Query(ctx, `
		SELECT id, subject, status, priority, category, created_at
		FROM support_tickets
		WHERE creator_type = 'DRIVER' AND creator_id = $1::uuid
		ORDER BY created_at DESC LIMIT 200`, id); err == nil {
		for rows.Next() {
			var t ticket
			if err := rows.Scan(&t.ID, &t.Subject, &t.Status, &t.Priority, &t.Category, &t.CreatedAt); err == nil {
				tickets = append(tickets, t)
			}
		}
		rows.Close()
	}
	writeExtrasJSON(w, tickets)
}
