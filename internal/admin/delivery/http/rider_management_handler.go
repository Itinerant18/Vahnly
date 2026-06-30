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
	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/notification"
)

// AdminRiderHandler serves the Phase 11 rider-management, promo, and car-issue
// admin APIs against the real tables (riders, orders, wallets, promo_codes,
// car_issue_reports). RBAC is enforced at route registration in cmd/gateway.
type AdminRiderHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
	notifier    *notification.RiderNotifier
	logger      *log.Logger
}

func NewAdminRiderHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, notifier *notification.RiderNotifier, logger *log.Logger) *AdminRiderHandler {
	return &AdminRiderHandler{dbPool: dbPool, redisClient: redisClient, notifier: notifier, logger: logger}
}

func (h *AdminRiderHandler) audit(ctx context.Context, email, action, details, ip string) {
	_, _ = h.dbPool.Exec(ctx, `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address)
		VALUES ($1, $2, $3, $4, $5)`,
		"00000000-0000-0000-0000-000000000000", email, action, details, ip)
}

func adminEmailOf(r *http.Request) string {
	e := r.Header.Get("X-Admin-Email")
	if e == "" {
		e = "admin@platform.com"
	}
	return e
}

func boundedInt(raw string, def, min, max int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/riders/{id}/status  (SUPER_ADMIN)
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleUpdateRiderStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Active bool   `json:"active"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Best-effort update of the real riders row.
	_, _ = h.dbPool.Exec(ctx, `UPDATE riders SET is_active = $1, updated_at = now() WHERE id = $2::uuid`, req.Active, id)

	// Keep the existing mock-backed detail view consistent by mirroring status in the
	// Redis override the legacy RiderHandler reads.
	status := "ACTIVE"
	if !req.Active {
		status = "SUSPENDED"
	}
	h.mergeStatusOverride(ctx, id, status)

	action := "RIDER_ACTIVATED"
	if !req.Active {
		action = "RIDER_DEACTIVATED"
	}
	h.audit(ctx, adminEmailOf(r), action,
		fmt.Sprintf("Admin set rider %s active=%t. Reason: %s", id, req.Active, req.Reason), getClientIP(r))

	// Push a notification to the rider on deactivation.
	if !req.Active && h.notifier != nil {
		_ = h.notifier.NotifyRider(ctx, id, "ACCOUNT_DEACTIVATED",
			"Your account has been deactivated",
			"Your Vahnly account has been deactivated. Contact support for assistance.",
			map[string]any{"reason": req.Reason})
	}

	writeRiderJSON(w, map[string]any{"status": "SUCCESS", "active": req.Active})
}

func (h *AdminRiderHandler) mergeStatusOverride(ctx context.Context, id, status string) {
	if h.redisClient == nil {
		return
	}
	key := "rider:override:" + id
	override := map[string]any{"customer_id": id}
	if val, err := h.redisClient.Get(ctx, key).Result(); err == nil && val != "" {
		_ = json.Unmarshal([]byte(val), &override)
	}
	override["status"] = status
	b, _ := json.Marshal(override)
	_ = h.redisClient.Set(ctx, key, b, 0).Err()
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/riders/{id}/orders
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleGetRiderOrders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return
	}
	q := r.URL.Query()
	limit := boundedInt(q.Get("limit"), 50, 1, 200)
	offset := boundedInt(q.Get("offset"), 0, 0, 1000000)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var total int64
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM orders WHERE customer_id = $1::uuid OR rider_id = $1::uuid`, id).Scan(&total)

	rows, err := h.dbPool.Query(ctx, `
		SELECT o.id::text, o.status::text, o.city_prefix, o.base_fare_paise,
		       COALESCE(d.name, 'Unassigned'), o.created_at
		FROM orders o
		LEFT JOIN drivers d ON d.id = o.assigned_driver_id
		WHERE o.customer_id = $1::uuid OR o.rider_id = $1::uuid
		ORDER BY o.created_at DESC
		LIMIT $2 OFFSET $3`, id, limit, offset)
	if err != nil {
		h.logger.Printf("[ADMIN_RIDER] orders query failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type orderItem struct {
		OrderID    string    `json:"order_id"`
		Status     string    `json:"status"`
		City       string    `json:"city_prefix"`
		FarePaise  int64     `json:"fare_paise"`
		DriverName string    `json:"driver_name"`
		CreatedAt  time.Time `json:"created_at"`
	}
	orders := make([]orderItem, 0)
	for rows.Next() {
		var o orderItem
		if err := rows.Scan(&o.OrderID, &o.Status, &o.City, &o.FarePaise, &o.DriverName, &o.CreatedAt); err == nil {
			orders = append(orders, o)
		}
	}
	writeRiderJSON(w, map[string]any{"orders": orders, "total": total, "limit": limit, "offset": offset})
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/riders/{id}/wallet
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleGetRiderWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var walletID string
	var balance int64
	err := h.dbPool.QueryRow(ctx,
		`SELECT id::text, balance_paise FROM wallets WHERE user_id = $1::uuid AND user_type = 'RIDER'`, id).
		Scan(&walletID, &balance)
	if err != nil && err != pgx.ErrNoRows {
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}

	type txn struct {
		AmountPaise int64     `json:"amount_paise"`
		EntryType   string    `json:"entry_type"`
		ReasonCode  string    `json:"reason_code"`
		Description string    `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}
	transactions := make([]txn, 0)
	if walletID != "" {
		rows, qErr := h.dbPool.Query(ctx, `
			SELECT amount_paise, entry_type, reason_code, description, created_at
			FROM wallet_ledger_entries WHERE wallet_id = $1::uuid
			ORDER BY created_at DESC LIMIT 200`, walletID)
		if qErr == nil {
			defer rows.Close()
			for rows.Next() {
				var t txn
				if err := rows.Scan(&t.AmountPaise, &t.EntryType, &t.ReasonCode, &t.Description, &t.CreatedAt); err == nil {
					transactions = append(transactions, t)
				}
			}
		}
	}
	writeRiderJSON(w, map[string]any{"balance_paise": balance, "transactions": transactions})
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/riders/{id}/wallet/adjust  (FINANCIAL_AUDITOR)
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleAdjustRiderWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_rider_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Type        string `json:"type"` // CREDIT | DEBIT
		AmountPaise int64  `json:"amount_paise"`
		Reason      string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Type = strings.ToUpper(strings.TrimSpace(req.Type))
	if req.Type != "CREDIT" && req.Type != "DEBIT" {
		http.Error(w, "invalid_type: must be CREDIT or DEBIT", http.StatusBadRequest)
		return
	}
	if req.AmountPaise <= 0 {
		http.Error(w, "invalid_amount: must be greater than zero", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Ensure a wallet row exists, then lock it.
	_, _ = tx.Exec(ctx, `
		INSERT INTO wallets (user_id, user_type, balance_paise) VALUES ($1::uuid, 'RIDER', 0)
		ON CONFLICT (user_id) DO NOTHING`, id)

	var walletID string
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT id::text, balance_paise FROM wallets WHERE user_id = $1::uuid FOR UPDATE`, id).
		Scan(&walletID, &balance); err != nil {
		http.Error(w, "wallet_lookup_failed", http.StatusInternalServerError)
		return
	}

	delta := req.AmountPaise
	if req.Type == "DEBIT" {
		delta = -req.AmountPaise
	}
	newBalance := balance + delta
	if newBalance < 0 {
		http.Error(w, "insufficient_balance", http.StatusConflict)
		return
	}

	if _, err := tx.Exec(ctx,
		`UPDATE wallets SET balance_paise = $1, updated_at = now() WHERE id = $2::uuid`, newBalance, walletID); err != nil {
		http.Error(w, "wallet_update_failed", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO wallet_ledger_entries (wallet_id, amount_paise, entry_type, reason_code, description)
		VALUES ($1::uuid, $2, $3, 'ADMIN_ADJUSTMENT', $4)`,
		walletID, req.AmountPaise, req.Type, req.Reason); err != nil {
		http.Error(w, "ledger_write_failed", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit_failed", http.StatusInternalServerError)
		return
	}

	h.audit(ctx, adminEmailOf(r), "RIDER_WALLET_ADJUSTED",
		fmt.Sprintf("Admin %s rider %s wallet by %d paise. Reason: %s", req.Type, id, req.AmountPaise, req.Reason), getClientIP(r))

	writeRiderJSON(w, map[string]any{"status": "SUCCESS", "balance_paise": newBalance})
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/promo-codes
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleListPromoCodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT p.id::text, p.code, p.description, p.discount_type, p.discount_value,
		       p.max_discount_paise, p.min_fare_paise, p.max_redemptions, p.per_rider_limit,
		       p.total_redeemed, COALESCE(p.city_prefix, ''), p.valid_from, p.valid_until, p.is_active,
		       COALESCE((SELECT SUM(discount_paise) FROM promo_redemptions pr WHERE pr.promo_code_id = p.id), 0)
		FROM promo_codes p
		ORDER BY p.created_at DESC`)
	if err != nil {
		h.logger.Printf("[ADMIN_PROMO] list failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type promo struct {
		ID                string     `json:"id"`
		Code              string     `json:"code"`
		Description       string     `json:"description"`
		DiscountType      string     `json:"discount_type"`
		DiscountValue     int64      `json:"discount_value"`
		MaxDiscountPaise  int64      `json:"max_discount_paise"`
		MinFarePaise      int64      `json:"min_fare_paise"`
		MaxRedemptions    *int       `json:"max_redemptions"`
		PerRiderLimit     int        `json:"per_rider_limit"`
		TotalRedeemed     int        `json:"total_redeemed"`
		CityPrefix        string     `json:"city_prefix"`
		ValidFrom         time.Time  `json:"valid_from"`
		ValidUntil        *time.Time `json:"valid_until"`
		IsActive          bool       `json:"is_active"`
		TotalSavingsPaise int64      `json:"total_savings_paise"`
	}
	list := make([]promo, 0)
	for rows.Next() {
		var p promo
		var desc *string
		if err := rows.Scan(&p.ID, &p.Code, &desc, &p.DiscountType, &p.DiscountValue,
			&p.MaxDiscountPaise, &p.MinFarePaise, &p.MaxRedemptions, &p.PerRiderLimit,
			&p.TotalRedeemed, &p.CityPrefix, &p.ValidFrom, &p.ValidUntil, &p.IsActive,
			&p.TotalSavingsPaise); err == nil {
			if desc != nil {
				p.Description = *desc
			}
			list = append(list, p)
		}
	}
	writeRiderJSON(w, list)
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/promo-codes  (MARKETING)
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleCreatePromoCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Code             string     `json:"code"`
		Description      string     `json:"description"`
		DiscountType     string     `json:"discount_type"` // FLAT | PERCENT
		DiscountValue    int64      `json:"discount_value"`
		MaxDiscountPaise int64      `json:"max_discount_paise"`
		MinFarePaise     int64      `json:"min_fare_paise"`
		MaxRedemptions   *int       `json:"max_redemptions"`
		PerRiderLimit    int        `json:"per_rider_limit"`
		CityPrefix       string     `json:"city_prefix"`
		ValidUntil       *time.Time `json:"valid_until"`
		IsActive         bool       `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Code = strings.ToUpper(strings.TrimSpace(req.Code))
	req.DiscountType = strings.ToUpper(strings.TrimSpace(req.DiscountType))
	if req.Code == "" || (req.DiscountType != "FLAT" && req.DiscountType != "PERCENT") || req.DiscountValue < 0 {
		http.Error(w, "invalid_promo_payload", http.StatusBadRequest)
		return
	}
	if req.PerRiderLimit <= 0 {
		req.PerRiderLimit = 1
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var cityArg interface{}
	if req.CityPrefix != "" {
		cityArg = req.CityPrefix
	}
	var newID string
	err := h.dbPool.QueryRow(ctx, `
		INSERT INTO promo_codes (code, description, discount_type, discount_value, max_discount_paise,
		                         min_fare_paise, max_redemptions, per_rider_limit, city_prefix, valid_until, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id::text`,
		req.Code, nullableStr(req.Description), req.DiscountType, req.DiscountValue, req.MaxDiscountPaise,
		req.MinFarePaise, req.MaxRedemptions, req.PerRiderLimit, cityArg, req.ValidUntil, req.IsActive).Scan(&newID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") {
			http.Error(w, "promo_code_already_exists", http.StatusConflict)
			return
		}
		h.logger.Printf("[ADMIN_PROMO] create failed: %v", err)
		http.Error(w, "database_write_failed", http.StatusInternalServerError)
		return
	}

	h.audit(ctx, adminEmailOf(r), "PROMO_CODE_CREATED",
		fmt.Sprintf("Admin created promo %s (%s %d)", req.Code, req.DiscountType, req.DiscountValue), getClientIP(r))
	writeRiderJSON(w, map[string]any{"status": "SUCCESS", "id": newID})
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/promo-codes/{id}
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleUpdatePromoCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_promo_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Description   *string    `json:"description"`
		DiscountValue *int64     `json:"discount_value"`
		MinFarePaise  *int64     `json:"min_fare_paise"`
		ValidUntil    *time.Time `json:"valid_until"`
		IsActive      *bool      `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	ct, err := h.dbPool.Exec(ctx, `
		UPDATE promo_codes SET
			description    = COALESCE($2, description),
			discount_value = COALESCE($3, discount_value),
			min_fare_paise = COALESCE($4, min_fare_paise),
			valid_until    = COALESCE($5, valid_until),
			is_active      = COALESCE($6, is_active),
			updated_at     = now()
		WHERE id = $1::uuid`,
		id, req.Description, req.DiscountValue, req.MinFarePaise, req.ValidUntil, req.IsActive)
	if err != nil {
		http.Error(w, "database_write_failed", http.StatusInternalServerError)
		return
	}
	if ct.RowsAffected() == 0 {
		http.Error(w, "promo_not_found", http.StatusNotFound)
		return
	}

	h.audit(ctx, adminEmailOf(r), "PROMO_CODE_UPDATED", fmt.Sprintf("Admin updated promo %s", id), getClientIP(r))
	writeRiderJSON(w, map[string]any{"status": "SUCCESS"})
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/promo-codes/{id}/usages
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleGetPromoUsages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_promo_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT pr.rider_id::text, COALESCE(r.name, ''), pr.order_id::text, pr.discount_paise, pr.created_at
		FROM promo_redemptions pr
		LEFT JOIN riders r ON r.id = pr.rider_id
		WHERE pr.promo_code_id = $1::uuid
		ORDER BY pr.created_at DESC`, id)
	if err != nil {
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type usage struct {
		RiderID       string    `json:"rider_id"`
		RiderName     string    `json:"rider_name"`
		OrderID       string    `json:"order_id"`
		DiscountPaise int64     `json:"discount_paise"`
		CreatedAt     time.Time `json:"created_at"`
	}
	usages := make([]usage, 0)
	var totalSaved int64
	for rows.Next() {
		var u usage
		if err := rows.Scan(&u.RiderID, &u.RiderName, &u.OrderID, &u.DiscountPaise, &u.CreatedAt); err == nil {
			usages = append(usages, u)
			totalSaved += u.DiscountPaise
		}
	}
	writeRiderJSON(w, map[string]any{"usages": usages, "total_savings_paise": totalSaved, "count": len(usages)})
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/car-issue-reports
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleListCarIssueReports(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	limit := boundedInt(q.Get("limit"), 50, 1, 200)
	offset := boundedInt(q.Get("offset"), 0, 0, 1000000)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	where := "WHERE 1=1"
	args := []interface{}{}
	idx := 1
	if q.Get("unreviewed") == "true" {
		where += " AND cir.reviewed = false"
	}
	if carID := q.Get("car_id"); carID != "" {
		where += fmt.Sprintf(" AND cir.rider_garage_car_id = $%d::uuid", idx)
		args = append(args, carID)
		idx++
	}
	if from := q.Get("from"); from != "" {
		if t, err := time.Parse("2006-01-02", from); err == nil {
			where += fmt.Sprintf(" AND cir.created_at >= $%d", idx)
			args = append(args, t)
			idx++
		}
	}
	if to := q.Get("to"); to != "" {
		if t, err := time.Parse("2006-01-02", to); err == nil {
			where += fmt.Sprintf(" AND cir.created_at <= $%d", idx)
			args = append(args, t.Add(24*time.Hour))
			idx++
		}
	}

	query := `
		SELECT cir.id::text, cir.order_id::text, cir.driver_id::text,
		       COALESCE(d.name, ''), COALESCE(o.customer_id::text, ''),
		       COALESCE(NULLIF(TRIM(COALESCE(g.make,'') || ' ' || COALESCE(g.model,'')), ''), 'Unknown car'),
		       COALESCE(g.car_type, ''), cir.issue_type, COALESCE(cir.description, ''),
		       cir.reviewed, COALESCE(cir.admin_notes, ''), cir.admin_notified, cir.created_at
		FROM car_issue_reports cir
		LEFT JOIN drivers d      ON d.id = cir.driver_id
		LEFT JOIN orders o       ON o.id = cir.order_id
		LEFT JOIN rider_garage g ON g.id = cir.rider_garage_car_id
		` + where + fmt.Sprintf(" ORDER BY cir.created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[ADMIN_CAR_ISSUE] list failed: %v", err)
		http.Error(w, "database_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type report struct {
		ID            string    `json:"id"`
		OrderID       string    `json:"order_id"`
		DriverID      string    `json:"driver_id"`
		DriverName    string    `json:"driver_name"`
		RiderID       string    `json:"rider_id"`
		Car           string    `json:"car"`
		CarType       string    `json:"car_type"`
		IssueType     string    `json:"issue_type"`
		Description   string    `json:"description"`
		Reviewed      bool      `json:"reviewed"`
		AdminNotes    string    `json:"admin_notes"`
		AdminNotified bool      `json:"admin_notified"`
		CreatedAt     time.Time `json:"created_at"`
	}
	reports := make([]report, 0)
	for rows.Next() {
		var rep report
		if err := rows.Scan(&rep.ID, &rep.OrderID, &rep.DriverID, &rep.DriverName, &rep.RiderID,
			&rep.Car, &rep.CarType, &rep.IssueType, &rep.Description, &rep.Reviewed,
			&rep.AdminNotes, &rep.AdminNotified, &rep.CreatedAt); err == nil {
			reports = append(reports, rep)
		}
	}
	writeRiderJSON(w, map[string]any{"reports": reports, "limit": limit, "offset": offset})
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/car-issue-reports/{id}
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleUpdateCarIssueReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_report_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Reviewed    bool   `json:"reviewed"`
		AdminNotes  string `json:"admin_notes"`
		NotifyRider bool   `json:"notify_rider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	email := adminEmailOf(r)
	var orderID string
	err := h.dbPool.QueryRow(ctx, `
		UPDATE car_issue_reports
		SET reviewed = $2, admin_notes = $3, reviewed_by = $4, reviewed_at = now()
		WHERE id = $1::uuid
		RETURNING order_id::text`, id, req.Reviewed, nullableStr(req.AdminNotes), email).Scan(&orderID)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "report_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_write_failed", http.StatusInternalServerError)
		return
	}

	h.audit(ctx, email, "CAR_ISSUE_REVIEWED",
		fmt.Sprintf("Admin reviewed car issue report %s (reviewed=%t)", id, req.Reviewed), getClientIP(r))

	if req.NotifyRider && h.notifier != nil {
		var riderID string
		_ = h.dbPool.QueryRow(ctx,
			`SELECT COALESCE(rider_id::text, customer_id::text) FROM orders WHERE id = $1::uuid`, orderID).Scan(&riderID)
		if riderID != "" {
			_ = h.notifier.NotifyRider(ctx, riderID, "CAR_ISSUE_UPDATE",
				"Update on your reported car issue",
				"Our team has reviewed the issue reported on your trip. Thank you for letting us know.",
				map[string]any{"report_id": id})
		}
	}

	writeRiderJSON(w, map[string]any{"status": "SUCCESS"})
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/riders/metrics  (dashboard rider metrics)
// ---------------------------------------------------------------------------

func (h *AdminRiderHandler) HandleRiderMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var activeToday, signupsToday, tripsToday int64
	var avgFareToday float64
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT customer_id) FROM orders WHERE created_at::date = CURRENT_DATE`).Scan(&activeToday)
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM riders WHERE created_at::date = CURRENT_DATE`).Scan(&signupsToday)
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(AVG(base_fare_paise), 0) FROM orders WHERE created_at::date = CURRENT_DATE`).
		Scan(&tripsToday, &avgFareToday)

	type point struct {
		Label string `json:"label"`
		Value int64  `json:"value"`
	}
	series := make([]point, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT created_at::date AS d, COUNT(*)
		FROM orders
		WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
		GROUP BY d ORDER BY d`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var d time.Time
			var c int64
			if err := rows.Scan(&d, &c); err == nil {
				series = append(series, point{Label: d.Format("Mon"), Value: c})
			}
		}
	}

	writeRiderJSON(w, map[string]any{
		"active_riders_today":  activeToday,
		"new_signups_today":    signupsToday,
		"trips_booked_today":   tripsToday,
		"avg_fare_paise_today": int64(avgFareToday),
		"daily_bookings":       series,
		"retention": map[string]any{
			"d1":  h.riderRetention(ctx, 1),
			"d7":  h.riderRetention(ctx, 7),
			"d30": h.riderRetention(ctx, 30),
		},
	})
}

// riderRetention returns the percentage of the cohort that signed up `days` ago
// and placed an order today, or nil when that cohort is empty.
func (h *AdminRiderHandler) riderRetention(ctx context.Context, days int) interface{} {
	var cohort, retained int64
	err := h.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE EXISTS (
				SELECT 1 FROM orders o
				WHERE o.customer_id = r.id AND o.created_at::date = CURRENT_DATE))
		FROM riders r
		WHERE r.created_at::date = CURRENT_DATE - $1::int`, days).Scan(&cohort, &retained)
	if err != nil || cohort == 0 {
		return nil
	}
	return int64(float64(retained) / float64(cohort) * 100.0)
}

// ---- shared helpers ----

func writeRiderJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
