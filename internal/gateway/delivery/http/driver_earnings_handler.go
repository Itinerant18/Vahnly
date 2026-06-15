package http

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

// DriverEarningsHandler backs the driver Earnings, Payouts and Wallet screens.
// Earnings + payouts are derived from financial_ledger_entries (account_type
// DRIVER_EARNINGS); the driver wallet (toll/fuel/referral) lives in driver_wallets.
// Every endpoint is scoped to the authenticated driver via requireDriverIdentity —
// identity is taken from the verified JWT, never a client header.
type DriverEarningsHandler struct {
	dbPool       *pgxpool.Pool
	redis        *redis.ClusterClient
	payoutWriter *kafka.Writer
	logger       *log.Logger
}

func NewDriverEarningsHandler(dbPool *pgxpool.Pool, rc *redis.ClusterClient, payoutWriter *kafka.Writer, logger *log.Logger) *DriverEarningsHandler {
	return &DriverEarningsHandler{dbPool: dbPool, redis: rc, payoutWriter: payoutWriter, logger: logger}
}

const (
	payoutMinPaise      = 10000 // ₹100 minimum withdrawal
	payoutCooldown      = time.Hour
	driverEarningsAcct  = "DRIVER_EARNINGS"
	payoutEstimatedTime = "~2 business hours"
)

// resolvePeriod maps period=TODAY|WEEK|MONTH|CUSTOM (+ from/to for CUSTOM) into a
// [from, to] time window. Defaults to TODAY on an unknown/blank period.
func resolvePeriod(r *http.Request) (string, time.Time, time.Time) {
	period := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("period")))
	now := time.Now()
	to := now
	var from time.Time
	switch period {
	case "WEEK":
		from = now.AddDate(0, 0, -7)
	case "MONTH":
		from = now.AddDate(0, 0, -30)
	case "CUSTOM":
		fromStr := r.URL.Query().Get("from")
		toStr := r.URL.Query().Get("to")
		if f, err := time.Parse("2006-01-02", fromStr); err == nil {
			from = f
		} else {
			from = now.AddDate(0, 0, -7)
		}
		if t, err := time.Parse("2006-01-02", toStr); err == nil {
			to = t.Add(24*time.Hour - time.Second) // inclusive end-of-day
		}
		return "CUSTOM", from, to
	default:
		period = "TODAY"
		from = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	}
	return period, from, to
}

// ─── Task 1: Earnings ─────────────────────────────────────────────────────────

type earningsSummary struct {
	GrossEarningsPaise      int64   `json:"gross_earnings_paise"`
	TipsPaise               int64   `json:"tips_paise"`
	BonusesPaise            int64   `json:"bonuses_paise"`
	IncentivesPaise         int64   `json:"incentives_paise"`
	PlatformDeductionsPaise int64   `json:"platform_deductions_paise"`
	NetEarningsPaise        int64   `json:"net_earnings_paise"`
	TripCount               int64   `json:"trip_count"`
	OnlineHours             float64 `json:"online_hours"`
	AcceptanceRate          float64 `json:"acceptance_rate"`
}

type dailyBreakdownItem struct {
	Date          string `json:"date"`
	EarningsPaise int64  `json:"earnings_paise"`
	Trips         int64  `json:"trips"`
}

type recentTripItem struct {
	OrderID             string    `json:"order_id"`
	PickupShort         string    `json:"pickup_short"`
	DropShort           string    `json:"drop_short"`
	FarePaise           int64     `json:"fare_paise"`
	DriverEarningsPaise int64     `json:"driver_earnings_paise"`
	TipPaise            int64     `json:"tip_paise"`
	CompletedAt         time.Time `json:"completed_at"`
	DistanceKm          float64   `json:"distance_km"`
	DurationMinutes     int       `json:"duration_minutes"`
}

// GET /api/v1/driver/earnings
func (h *DriverEarningsHandler) GetEarnings(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	period, from, to := resolvePeriod(r)

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var s earningsSummary
	err := h.dbPool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN entry_type='CREDIT' THEN amount_paise ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type='CREDIT' AND description ILIKE '%tip%' THEN amount_paise ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type='CREDIT' AND description ILIKE '%bonus%' THEN amount_paise ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type='CREDIT' AND description ILIKE '%incentive%' THEN amount_paise ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN entry_type='DEBIT' THEN amount_paise ELSE 0 END), 0),
			COUNT(DISTINCT CASE WHEN entry_type='CREDIT' THEN order_id END)
		FROM financial_ledger_entries
		WHERE driver_id = $1::uuid AND account_type = $2 AND created_at BETWEEN $3 AND $4
	`, driverID, driverEarningsAcct, from, to).Scan(
		&s.GrossEarningsPaise, &s.TipsPaise, &s.BonusesPaise, &s.IncentivesPaise, &s.PlatformDeductionsPaise, &s.TripCount,
	)
	if err != nil {
		h.logger.Printf("[DRIVER_EARNINGS] summary query failed: %v", err)
		http.Error(w, "earnings_query_failed", http.StatusInternalServerError)
		return
	}
	s.NetEarningsPaise = s.GrossEarningsPaise - s.PlatformDeductionsPaise

	// acceptance_rate is a maintained driver stat; online_hours has no ledger source
	// (driver duty-session aggregation is a separate follow-up) — reported as 0.
	_ = h.dbPool.QueryRow(ctx, `SELECT COALESCE(acceptance_rate, 0) FROM drivers WHERE id = $1::uuid`, driverID).Scan(&s.AcceptanceRate)

	daily := make([]dailyBreakdownItem, 0)
	if rows, qerr := h.dbPool.Query(ctx, `
		SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
		       COALESCE(SUM(CASE WHEN entry_type='CREDIT' THEN amount_paise ELSE 0 END), 0),
		       COUNT(DISTINCT CASE WHEN entry_type='CREDIT' THEN order_id END)
		FROM financial_ledger_entries
		WHERE driver_id = $1::uuid AND account_type = $2 AND created_at BETWEEN $3 AND $4
		GROUP BY 1 ORDER BY 1
	`, driverID, driverEarningsAcct, from, to); qerr == nil {
		defer rows.Close()
		for rows.Next() {
			var d dailyBreakdownItem
			if rows.Scan(&d.Date, &d.EarningsPaise, &d.Trips) == nil {
				daily = append(daily, d)
			}
		}
	}

	trips := make([]recentTripItem, 0)
	if rows, qerr := h.dbPool.Query(ctx, `
		SELECT f.order_id::text, COALESCE(o.base_fare_paise, 0), f.amount_paise, f.created_at,
		       COALESCE(o.pickup_h3_cell, '')
		FROM financial_ledger_entries f
		LEFT JOIN orders o ON o.id = f.order_id
		WHERE f.driver_id = $1::uuid AND f.account_type = $2 AND f.entry_type = 'CREDIT'
		  AND f.created_at BETWEEN $3 AND $4
		ORDER BY f.created_at DESC LIMIT 20
	`, driverID, driverEarningsAcct, from, to); qerr == nil {
		defer rows.Close()
		for rows.Next() {
			var t recentTripItem
			var pickup string
			if rows.Scan(&t.OrderID, &t.FarePaise, &t.DriverEarningsPaise, &t.CompletedAt, &pickup) == nil {
				t.PickupShort = pickup
				trips = append(trips, t)
			}
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]any{
		"period":          period,
		"summary":         s,
		"daily_breakdown": daily,
		"recent_trips":    trips,
	})
}

// GET /api/v1/driver/earnings/statement?year=2026&month=6
// Stub: streams a CSV generated on-the-fly from the ledger for the month. (A real
// deployment would return a signed URL to a pre-generated statement object.)
func (h *DriverEarningsHandler) GetStatement(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	now := time.Now()
	year, _ := strconv.Atoi(r.URL.Query().Get("year"))
	month, _ := strconv.Atoi(r.URL.Query().Get("month"))
	if year == 0 {
		year = now.Year()
	}
	if month < 1 || month > 12 {
		month = int(now.Month())
	}
	from := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := h.dbPool.Query(ctx, `
		SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI:SS'), order_id::text, entry_type, amount_paise, description
		FROM financial_ledger_entries
		WHERE driver_id = $1::uuid AND account_type = $2 AND created_at >= $3 AND created_at < $4
		ORDER BY created_at ASC
	`, driverID, driverEarningsAcct, from, to)
	if err != nil {
		http.Error(w, "statement_query_failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=earnings-statement-%04d-%02d.csv", year, month))
	cw := csv.NewWriter(w)
	defer cw.Flush()
	_ = cw.Write([]string{"date", "order_id", "entry_type", "amount_rupees", "description"})
	for rows.Next() {
		var date, orderID, entryType, desc string
		var amount int64
		if rows.Scan(&date, &orderID, &entryType, &amount, &desc) == nil {
			_ = cw.Write([]string{date, orderID, entryType, fmt.Sprintf("%.2f", float64(amount)/100), desc})
		}
	}
}

// ─── Task 2: Payouts ──────────────────────────────────────────────────────────

// availableBalance returns the driver's withdrawable balance in paise: lifetime
// net DRIVER_EARNINGS (CREDIT − DEBIT) minus payouts already requested/paid.
func (h *DriverEarningsHandler) availableBalance(ctx context.Context, driverID string) (int64, error) {
	var ledgerNet, committed int64
	if err := h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN entry_type='CREDIT' THEN amount_paise ELSE 0 END)
		             - SUM(CASE WHEN entry_type='DEBIT' THEN amount_paise ELSE 0 END), 0)
		FROM financial_ledger_entries
		WHERE driver_id = $1::uuid AND account_type = $2
	`, driverID, driverEarningsAcct).Scan(&ledgerNet); err != nil {
		return 0, err
	}
	if err := h.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_paise), 0) FROM payout_requests
		WHERE driver_id = $1::uuid AND status IN ('PENDING','PROCESSING','PAID')
	`, driverID).Scan(&committed); err != nil {
		return 0, err
	}
	avail := ledgerNet - committed
	if avail < 0 {
		avail = 0
	}
	return avail, nil
}

func maskAccount(acct string) string {
	acct = strings.TrimSpace(acct)
	if len(acct) <= 4 {
		return acct
	}
	return "••••" + acct[len(acct)-4:]
}

type payoutHistoryItem struct {
	ID             string    `json:"id"`
	AmountPaise    int64     `json:"amount_paise"`
	NetAmountPaise int64     `json:"net_amount_paise"`
	Status         string    `json:"status"`
	FailureReason  *string   `json:"failure_reason"`
	RequestedAt    time.Time `json:"requested_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// GET /api/v1/driver/payouts
func (h *DriverEarningsHandler) GetPayouts(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	avail, err := h.availableBalance(ctx, driverID)
	if err != nil {
		http.Error(w, "balance_query_failed", http.StatusInternalServerError)
		return
	}

	var bankName, bankAcct, bankIfsc *string
	var bankVerified bool
	_ = h.dbPool.QueryRow(ctx, `
		SELECT bank_name, bank_account_number, bank_ifsc, bank_verified FROM drivers WHERE id = $1::uuid
	`, driverID).Scan(&bankName, &bankAcct, &bankIfsc, &bankVerified)

	bank := map[string]any{"verified": bankVerified}
	if bankName != nil {
		bank["bank_name"] = *bankName
	}
	if bankIfsc != nil {
		bank["ifsc"] = *bankIfsc
	}
	if bankAcct != nil {
		bank["account_masked"] = maskAccount(*bankAcct)
	}

	history := make([]payoutHistoryItem, 0)
	if rows, qerr := h.dbPool.Query(ctx, `
		SELECT id, amount_paise, net_amount_paise, status, failure_reason, created_at, updated_at
		FROM payout_requests WHERE driver_id = $1::uuid ORDER BY created_at DESC LIMIT 50
	`, driverID); qerr == nil {
		defer rows.Close()
		for rows.Next() {
			var p payoutHistoryItem
			if rows.Scan(&p.ID, &p.AmountPaise, &p.NetAmountPaise, &p.Status, &p.FailureReason, &p.RequestedAt, &p.UpdatedAt) == nil {
				history = append(history, p)
			}
		}
	}

	writeJSONResponse(w, http.StatusOK, map[string]any{
		"available_balance_paise": avail,
		"bank_account":            bank,
		"upi_id":                  "", // no upi_id column on drivers yet
		"payout_history":          history,
	})
}

// POST /api/v1/driver/payouts/request  body: { amount_paise }
func (h *DriverEarningsHandler) RequestPayout(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		AmountPaise int64 `json:"amount_paise"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.AmountPaise < payoutMinPaise {
		http.Error(w, "amount_below_minimum_100", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// 1. KYC: bank must be verified before any payout.
	var bankVerified bool
	if err := h.dbPool.QueryRow(ctx, `SELECT COALESCE(bank_verified, false) FROM drivers WHERE id = $1::uuid`, driverID).Scan(&bankVerified); err != nil {
		http.Error(w, "driver_not_found", http.StatusNotFound)
		return
	}
	if !bankVerified {
		http.Error(w, "kyc_incomplete_bank_unverified", http.StatusForbidden)
		return
	}

	// 2. Balance check.
	avail, err := h.availableBalance(ctx, driverID)
	if err != nil {
		http.Error(w, "balance_query_failed", http.StatusInternalServerError)
		return
	}
	if req.AmountPaise > avail {
		http.Error(w, "amount_exceeds_available_balance", http.StatusBadRequest)
		return
	}

	// 3. Idempotency / cooldown: one payout request per driver per hour. SET NX EX
	//    returns false when a key already exists → duplicate within the window.
	if h.redis != nil {
		set, rerr := h.redis.SetNX(ctx, "driver:payout:cooldown:"+driverID, "1", payoutCooldown).Result()
		if rerr == nil && !set {
			http.Error(w, "payout_already_requested", http.StatusConflict)
			return
		}
	}

	// 4. Persist the request (PENDING).
	payoutID := "po_" + uuid.NewString()
	if _, err := h.dbPool.Exec(ctx, `
		INSERT INTO payout_requests (id, driver_id, amount_paise, net_amount_paise, status, created_at, updated_at)
		VALUES ($1, $2::uuid, $3, $3, 'PENDING', NOW(), NOW())
	`, payoutID, driverID, req.AmountPaise); err != nil {
		// Roll back the cooldown so a DB failure doesn't lock the driver out for an hour.
		if h.redis != nil {
			_ = h.redis.Del(ctx, "driver:payout:cooldown:"+driverID).Err()
		}
		http.Error(w, "payout_insert_failed", http.StatusInternalServerError)
		return
	}

	// 5. Emit the settlement event (best-effort; the request is already durable).
	if h.payoutWriter != nil {
		evt, _ := json.Marshal(map[string]any{
			"payout_id": payoutID, "driver_id": driverID, "amount_paise": req.AmountPaise,
		})
		if werr := h.payoutWriter.WriteMessages(ctx, kafka.Message{Key: []byte(driverID), Value: evt}); werr != nil {
			h.logger.Printf("[DRIVER_PAYOUT] kafka publish failed for %s: %v", payoutID, werr)
		}
	}

	writeJSONResponse(w, http.StatusAccepted, map[string]any{
		"payout_id":      payoutID,
		"status":         "PENDING",
		"estimated_time": payoutEstimatedTime,
	})
}

// GET /api/v1/driver/payouts/{payoutId}
func (h *DriverEarningsHandler) GetPayoutDetail(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	payoutID := r.PathValue("payoutId")
	if payoutID == "" {
		http.Error(w, "missing_payout_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var p payoutHistoryItem
	// Scope to the authenticated driver so one driver can't read another's payout.
	err := h.dbPool.QueryRow(ctx, `
		SELECT id, amount_paise, net_amount_paise, status, failure_reason, created_at, updated_at
		FROM payout_requests WHERE id = $1 AND driver_id = $2::uuid
	`, payoutID, driverID).Scan(&p.ID, &p.AmountPaise, &p.NetAmountPaise, &p.Status, &p.FailureReason, &p.RequestedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "payout_not_found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "payout_query_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, p)
}

// ─── Task 3: Driver wallet top-up (ADMIN only) ────────────────────────────────

// POST /api/v1/driver/wallet/topup  body: { driver_id, amount_paise, description }
// Admin-triggered (guarded by RequireAnyRole at the route). The driver wallet is
// system-managed (toll/fuel/referral) — there is no self-service top-up.
func (h *DriverEarningsHandler) AdminWalletTopup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DriverID    string `json:"driver_id"`
		AmountPaise int64  `json:"amount_paise"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.DriverID); err != nil {
		http.Error(w, "invalid_driver_id", http.StatusBadRequest)
		return
	}
	if req.AmountPaise == 0 {
		http.Error(w, "amount_required", http.StatusBadRequest)
		return
	}
	entryType := "CREDIT"
	if req.AmountPaise < 0 {
		entryType = "DEBIT"
	}
	if strings.TrimSpace(req.Description) == "" {
		req.Description = "Admin wallet adjustment"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "wallet_tx_begin_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO driver_wallets (driver_id, available_balance, updated_at)
		VALUES ($1::uuid, $2, NOW())
		ON CONFLICT (driver_id) DO UPDATE
		SET available_balance = driver_wallets.available_balance + $2, updated_at = NOW()
	`, req.DriverID, req.AmountPaise); err != nil {
		http.Error(w, "wallet_balance_update_failed", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO driver_wallet_transactions (id, driver_id, amount_paise, entry_type, description, created_at)
		VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, NOW())
	`, req.DriverID, req.AmountPaise, entryType, req.Description); err != nil {
		http.Error(w, "wallet_txn_insert_failed", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "wallet_tx_commit_failed", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"status": "SUCCESS", "entry_type": entryType})
}
