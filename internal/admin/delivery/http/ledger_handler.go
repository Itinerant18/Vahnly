package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

type DiscrepancyRecord struct {
	OrderID          string `json:"order_id"`
	CityPrefix       string `json:"city_prefix"`
	DiscrepancyPaise int64  `json:"discrepancy_paise"`
	EntryCount       int    `json:"entry_count"`
}

type CorrectionRequest struct {
	OrderID     string `json:"order_id"`
	CityPrefix  string `json:"city_prefix"`
	AccountType string `json:"account_type"` // e.g. "PLATFORM_COMMISSION", "DRIVER_PAYOUT"
	EntryType   string `json:"entry_type"`   // "DEBIT" or "CREDIT"
	AmountPaise int64  `json:"amount_paise"`
	Description string `json:"description"`
}

type LedgerAdminHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewLedgerAdminHandler(dbPool *pgxpool.Pool, logger *log.Logger) *LedgerAdminHandler {
	return &LedgerAdminHandler{dbPool: dbPool, logger: logger}
}

// HandleGetLedgerDiscrepancies uncovers all order segments where double-entry sums do not match zero.
func (h *LedgerAdminHandler) HandleGetLedgerDiscrepancies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	// Isolation query evaluating balancing conditions per order sequence
	query := `
		SELECT order_id, city_prefix,
		       SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_paise ELSE -amount_paise END) AS discrepancy_paise,
		       COUNT(*) AS entry_count
		FROM financial_ledger_entries
		GROUP BY order_id, city_prefix
		HAVING SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_paise ELSE -amount_paise END) != 0
		ORDER BY MAX(created_at) DESC
		LIMIT 50;
	`

	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		h.logger.Printf("[RECONCILIATION_QUERY_FAILURE] Database evaluation failed: %v", err)
		http.Error(w, "internal_audit_failure", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	discrepancies := make([]DiscrepancyRecord, 0)
	for rows.Next() {
		var rec DiscrepancyRecord
		if err := rows.Scan(&rec.OrderID, &rec.CityPrefix, &rec.DiscrepancyPaise, &rec.EntryCount); err != nil {
			continue
		}
		discrepancies = append(discrepancies, rec)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"discrepancies": discrepancies,
	})
}

// HandlePostLedgerCorrection writes a manual corrective balance row inside an isolated transaction block.
func (h *LedgerAdminHandler) HandlePostLedgerCorrection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "FINANCIAL_AUDITOR" {
		http.Error(w, "insufficient_financial_clearance_tokens", http.StatusForbidden)
		return
	}

	var req CorrectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}

	if req.OrderID == "" || req.CityPrefix == "" || req.AmountPaise <= 0 || (req.EntryType != "DEBIT" && req.EntryType != "CREDIT") {
		http.Error(w, "invalid_reconciliation_parameters", http.StatusUnprocessableEntity)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// Attribute this sensitive financial adjustment to the acting admin. The admin
	// id comes from the verified JWT context; email/role from gateway-set headers.
	adminID, _ := middleware.GetUserIDFromContext(ctx)
	adminEmail := r.Header.Get("X-Admin-Email")
	ip := getClientIP(r)
	actor := adminEmail
	if actor == "" {
		actor = adminRole
	}

	// Enforce strict single-node serializable transaction commitment safety
	tx, err := h.dbPool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		http.Error(w, "isolation_level_negotiation_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// regional_settlement_zone is NOT NULL (migration 000032); mirror the city_prefix backfill convention.
	// The acting admin is embedded in the description so the ledger row itself carries immutable attribution.
	insertQuery := `
		INSERT INTO financial_ledger_entries
		    (order_id, city_prefix, account_type, entry_type, amount_paise, description, regional_settlement_zone, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $2, NOW());
	`
	entryDescription := "[MANUAL_RECONCILIATION_ADJUSTMENT by " + actor + "] " + req.Description
	_, err = tx.Exec(ctx, insertQuery, req.OrderID, req.CityPrefix, req.AccountType, req.EntryType, req.AmountPaise, entryDescription)
	if err != nil {
		h.logger.Printf("[MANUAL_LEDGER_ADJUSTMENT_FAILURE] Order %s insert failed: %v", req.OrderID, err)
		http.Error(w, "ledger_insertion_aborted", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_aborted", http.StatusInternalServerError)
		return
	}

	// Persist a tamper-evident audit record of who adjusted the ledger and how.
	h.recordAuditLog(ctx, adminID, adminEmail, "LEDGER_MANUAL_CORRECTION",
		fmt.Sprintf("Admin (%s) posted %s %d paise to %s on order %s [%s]. Reason: %s",
			adminRole, req.EntryType, req.AmountPaise, req.AccountType, req.OrderID, req.CityPrefix, req.Description), ip)

	h.logger.Printf("[MANUAL_LEDGER_ADJUSTMENT_COMMITTED] Order %s adjusted with %d Paise %s entry by %s.", req.OrderID, req.AmountPaise, req.EntryType, actor)
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(`{"status":"DISCREPANCY_RECONCILED_SUCCESSFULLY"}`))
}

// recordAuditLog writes a tamper-evident admin action row mirroring the convention
// used across the other admin handlers.
func (h *LedgerAdminHandler) recordAuditLog(ctx context.Context, adminID, email, action, details, ip string) {
	var idVal interface{} = adminID
	if adminID == "" {
		idVal = "00000000-0000-0000-0000-000000000000"
	}
	_, _ = h.dbPool.Exec(ctx,
		`INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)`,
		idVal, email, action, details, ip)
}
