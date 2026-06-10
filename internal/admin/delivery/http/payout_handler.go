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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PayoutHandler struct {
	dbPool *pgxpool.Pool
	logger *log.Logger
}

func NewPayoutHandler(dbPool *pgxpool.Pool, logger *log.Logger) *PayoutHandler {
	return &PayoutHandler{dbPool: dbPool, logger: logger}
}

// payoutBatchLockKey is a fixed advisory-lock key that serializes batch payout
// mutations (bulk-approve, export) across concurrent admin requests so two runs
// cannot double-process the same drivers. The xact lock auto-releases on commit.
const payoutBatchLockKey int64 = 0x5041594F5554 // "PAYOUT"

type PayoutListItem struct {
	ID                   string    `json:"id"`
	DriverID             string    `json:"driver_id"`
	DriverName           string    `json:"driver_name"`
	DriverPhone          string    `json:"driver_phone"`
	BackgroundStatus     string    `json:"background_check_status"`
	BankName             *string   `json:"bank_name"`
	BankAccountNumber    *string   `json:"bank_account_number"`
	BankIfsc             *string   `json:"bank_ifsc"`
	BankVerified         bool      `json:"bank_verified"`
	PayoutHold           bool      `json:"payout_hold"`
	PayoutHoldReason     *string   `json:"payout_hold_reason"`
	AmountPaise          int64     `json:"amount_paise"`
	TdsPaise             int64     `json:"tds_paise"`
	ProfessionalFeesPaise int64     `json:"professional_fees_paise"`
	NetAmountPaise       int64     `json:"net_amount_paise"`
	Status               string    `json:"status"`
	FailureReason        *string   `json:"failure_reason"`
	HoldReason           *string   `json:"hold_reason"`
	PayoutBatchID        *string   `json:"payout_batch_id"`
	BankReference        *string   `json:"bank_reference"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// HandleGetPayouts retrieves all payouts with sorting and query filtering
func (h *PayoutHandler) HandleGetPayouts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	q := r.URL.Query()
	limit := parseBoundedQueryInt(q.Get("limit"), 50, 1, 100)
	offset := parseBoundedQueryInt(q.Get("offset"), 0, 0, 100000)

	status := q.Get("status")
	driverID := q.Get("driver_id")
	payoutBatchID := q.Get("payout_batch_id")
	search := q.Get("search")

	query := `
		SELECT 
			p.id, p.driver_id, d.name as driver_name, d.phone as driver_phone,
			d.background_check_status, d.bank_name, d.bank_account_number, d.bank_ifsc,
			d.bank_verified, d.payout_hold, d.payout_hold_reason,
			p.amount_paise, p.tds_paise, p.professional_fees_paise, p.net_amount_paise,
			p.status, p.failure_reason, p.hold_reason, p.payout_batch_id, p.bank_reference,
			p.created_at, p.updated_at
		FROM payout_requests p
		JOIN drivers d ON d.id = p.driver_id
		WHERE 1=1
	`
	var args []interface{}
	argIdx := 1

	if status != "" {
		query += fmt.Sprintf(" AND p.status = $%d", argIdx)
		args = append(args, strings.ToUpper(status))
		argIdx++
	}
	if driverID != "" {
		query += fmt.Sprintf(" AND p.driver_id = $%d::uuid", argIdx)
		args = append(args, driverID)
		argIdx++
	}
	if payoutBatchID != "" {
		query += fmt.Sprintf(" AND p.payout_batch_id = $%d", argIdx)
		args = append(args, payoutBatchID)
		argIdx++
	}
	if search != "" {
		query += fmt.Sprintf(" AND (p.id ILIKE $%d OR d.name ILIKE $%d OR p.payout_batch_id ILIKE $%d)", argIdx, argIdx, argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	// Fetch count
	countQuery := "SELECT COUNT(*) FROM (" + query + ") count_t"
	var total int64
	err := h.dbPool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		h.logger.Printf("[PAYOUTS_ERROR] Failed counting payouts: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}

	query += fmt.Sprintf(" ORDER BY p.created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := h.dbPool.Query(ctx, query, args...)
	if err != nil {
		h.logger.Printf("[PAYOUTS_ERROR] Failed querying payouts: %v", err)
		http.Error(w, "internal_db_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	payouts := make([]PayoutListItem, 0)
	for rows.Next() {
		var item PayoutListItem
		var bankName, bankAccount, bankIfsc, payoutHoldReason, failureReason, holdReason, payoutBatchID, bankRef sql.NullString
		err := rows.Scan(
			&item.ID, &item.DriverID, &item.DriverName, &item.DriverPhone,
			&item.BackgroundStatus, &bankName, &bankAccount, &bankIfsc,
			&item.BankVerified, &item.PayoutHold, &payoutHoldReason,
			&item.AmountPaise, &item.TdsPaise, &item.ProfessionalFeesPaise, &item.NetAmountPaise,
			&item.Status, &failureReason, &holdReason, &payoutBatchID, &item.BankReference,
			&item.CreatedAt, &item.UpdatedAt,
		)
		if err == nil {
			if bankName.Valid { val := bankName.String; item.BankName = &val }
			if bankAccount.Valid { val := bankAccount.String; item.BankAccountNumber = &val }
			if bankIfsc.Valid { val := bankIfsc.String; item.BankIfsc = &val }
			if payoutHoldReason.Valid { val := payoutHoldReason.String; item.PayoutHoldReason = &val }
			if failureReason.Valid { val := failureReason.String; item.FailureReason = &val }
			if holdReason.Valid { val := holdReason.String; item.HoldReason = &val }
			if payoutBatchID.Valid { val := payoutBatchID.String; item.PayoutBatchID = &val }
			if bankRef.Valid { val := bankRef.String; item.BankReference = &val }
			payouts = append(payouts, item)
		} else {
			h.logger.Printf("[PAYOUTS_ERROR] Row scan failed: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"payouts": payouts,
		"total":   total,
	})
}

// HandleGetPayoutDetail retrieves detail of a single payout request
func (h *PayoutHandler) HandleGetPayoutDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_payout_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var item PayoutListItem
	var bankName, bankAccount, bankIfsc, payoutHoldReason, failureReason, holdReason, payoutBatchID, bankRef sql.NullString

	query := `
		SELECT 
			p.id, p.driver_id, d.name as driver_name, d.phone as driver_phone,
			d.background_check_status, d.bank_name, d.bank_account_number, d.bank_ifsc,
			d.bank_verified, d.payout_hold, d.payout_hold_reason,
			p.amount_paise, p.tds_paise, p.professional_fees_paise, p.net_amount_paise,
			p.status, p.failure_reason, p.hold_reason, p.payout_batch_id, p.bank_reference,
			p.created_at, p.updated_at
		FROM payout_requests p
		JOIN drivers d ON d.id = p.driver_id
		WHERE p.id = $1
	`
	err := h.dbPool.QueryRow(ctx, query, id).Scan(
		&item.ID, &item.DriverID, &item.DriverName, &item.DriverPhone,
		&item.BackgroundStatus, &bankName, &bankAccount, &bankIfsc,
		&item.BankVerified, &item.PayoutHold, &payoutHoldReason,
		&item.AmountPaise, &item.TdsPaise, &item.ProfessionalFeesPaise, &item.NetAmountPaise,
		&item.Status, &failureReason, &holdReason, &payoutBatchID, &bankRef,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "payout_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if bankName.Valid { val := bankName.String; item.BankName = &val }
	if bankAccount.Valid { val := bankAccount.String; item.BankAccountNumber = &val }
	if bankIfsc.Valid { val := bankIfsc.String; item.BankIfsc = &val }
	if payoutHoldReason.Valid { val := payoutHoldReason.String; item.PayoutHoldReason = &val }
	if failureReason.Valid { val := failureReason.String; item.FailureReason = &val }
	if holdReason.Valid { val := holdReason.String; item.HoldReason = &val }
	if payoutBatchID.Valid { val := payoutBatchID.String; item.PayoutBatchID = &val }
	if bankRef.Valid { val := bankRef.String; item.BankReference = &val }

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(mustMarshal(item))
}

// HandleBulkApprovePayouts bulk approves a list of payout requests after verifying eligibility
func (h *PayoutHandler) HandleBulkApprovePayouts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		http.Error(w, "invalid_ids_payload", http.StatusBadRequest)
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

	// Serialize batch payout mutations so two concurrent runs cannot double-process.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", payoutBatchLockKey); err != nil {
		http.Error(w, "payout_lock_failed", http.StatusServiceUnavailable)
		return
	}

	approvedCount := 0
	skippedCount := 0
	skippedDetails := make([]map[string]string, 0)

	for _, id := range req.IDs {
		var status string
		var driverID string
		var amount int64
		// Fetch eligibility parameters
		var kycStatus string
		var bankVerified bool
		var payoutHold bool
		var payoutHoldReason sql.NullString

		query := `
			SELECT p.status, p.driver_id, p.amount_paise, d.background_check_status, d.bank_verified, d.payout_hold, d.payout_hold_reason
			FROM payout_requests p
			JOIN drivers d ON d.id = p.driver_id
			WHERE p.id = $1
			FOR UPDATE
		`
		err = tx.QueryRow(ctx, query, id).Scan(&status, &driverID, &amount, &kycStatus, &bankVerified, &payoutHold, &payoutHoldReason)
		if err != nil {
			skippedCount++
			skippedDetails = append(skippedDetails, map[string]string{
				"id":     id,
				"reason": "payout_not_found",
			})
			continue
		}

		if status != "PENDING" {
			skippedCount++
			skippedDetails = append(skippedDetails, map[string]string{
				"id":     id,
				"reason": fmt.Sprintf("invalid_status_is_%s", status),
			})
			continue
		}

		// Eligibility checks:
		// 1. KYC complete (background_check_status == 'APPROVED')
		// 2. Bank details verified
		// 3. No payout holds
		var ineligibilityReasons []string
		if kycStatus != "APPROVED" {
			ineligibilityReasons = append(ineligibilityReasons, "KYC check incomplete or pending")
		}
		if !bankVerified {
			ineligibilityReasons = append(ineligibilityReasons, "bank details unverified")
		}
		if payoutHold {
			reason := "payout hold enabled"
			if payoutHoldReason.Valid {
				reason += fmt.Sprintf(" (%s)", payoutHoldReason.String)
			}
			ineligibilityReasons = append(ineligibilityReasons, reason)
		}

		if len(ineligibilityReasons) > 0 {
			skippedCount++
			skippedDetails = append(skippedDetails, map[string]string{
				"id":     id,
				"reason": strings.Join(ineligibilityReasons, ", "),
			})
			continue
		}

		// Transition to APPROVED
		updateQuery := "UPDATE payout_requests SET status = 'APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = $1"
		_, err = tx.Exec(ctx, updateQuery, id)
		if err != nil {
			h.logger.Printf("[PAYOUTS_ERROR] Failed updating status for %s: %v", id, err)
			http.Error(w, "database_update_failed", http.StatusInternalServerError)
			return
		}
		approvedCount++
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"approved_count":  approvedCount,
		"skipped_count":   skippedCount,
		"skipped_details": skippedDetails,
	})
}

// HandleExportPayoutBatch exports APPROVED payouts into NEFT/IMPS/UPI batch files, transitioning status to PROCESSING
func (h *PayoutHandler) HandleExportPayoutBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Serialize batch payout mutations so two concurrent exports cannot both emit a
	// batch for the same APPROVED rows.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", payoutBatchLockKey); err != nil {
		http.Error(w, "payout_lock_failed", http.StatusServiceUnavailable)
		return
	}

	// Fetch all APPROVED payouts
	query := `
		SELECT 
			p.id, p.driver_id, d.name as driver_name, d.bank_name, d.bank_account_number, d.bank_ifsc,
			p.amount_paise, p.tds_paise, p.professional_fees_paise, p.net_amount_paise, p.created_at
		FROM payout_requests p
		JOIN drivers d ON d.id = p.driver_id
		WHERE p.status = 'APPROVED'
		FOR UPDATE
	`
	rows, err := tx.Query(ctx, query)
	if err != nil {
		h.logger.Printf("[PAYOUTS_ERROR] Querying approved payouts failed: %v", err)
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ExportItem struct {
		ID            string
		DriverID      string
		DriverName    string
		BankName      string
		AccountNumber string
		IFSC          string
		Amount        int64
		TDS           int64
		Fees          int64
		Net           int64
		CreatedAt     time.Time
	}

	items := make([]ExportItem, 0)
	for rows.Next() {
		var item ExportItem
		var bankName, bankAccount, bankIfsc sql.NullString
		err := rows.Scan(
			&item.ID, &item.DriverID, &item.DriverName, &bankName, &bankAccount, &bankIfsc,
			&item.Amount, &item.TDS, &item.Fees, &item.Net, &item.CreatedAt,
		)
		if err == nil {
			if bankName.Valid { item.BankName = bankName.String }
			if bankAccount.Valid { item.AccountNumber = bankAccount.String }
			if bankIfsc.Valid { item.IFSC = bankIfsc.String }
			items = append(items, item)
		}
	}
	rows.Close() // close early to commit updates

	if len(items) == 0 {
		http.Error(w, "no_approved_payouts_to_export", http.StatusNotFound)
		return
	}

	batchID := fmt.Sprintf("BATCH-%s-%d", time.Now().Format("20060102"), time.Now().UnixNano()%10000)

	// Update payout status to PROCESSING and set batch ID
	updateQuery := "UPDATE payout_requests SET status = 'PROCESSING', payout_batch_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
	for _, item := range items {
		_, err = tx.Exec(ctx, updateQuery, item.ID, batchID)
		if err != nil {
			h.logger.Printf("[PAYOUTS_ERROR] Failed transitioning payout %s: %v", item.ID, err)
			http.Error(w, "database_update_failed", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "transaction_commit_failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="payout_batch_%s.csv"`, batchID))
	w.Header().Set("Content-Type", "text/csv")

	// Print CSV structure (NEFT/IMPS/UPI specifications)
	fmt.Fprintf(w, "Payout ID,Driver ID,Beneficiary Name,Bank Name,Account Number,IFSC Code,Total Payout (Paise),TDS Deduction (Paise),Fees (Paise),Net Settlement (Paise),Created At\n")
	for _, item := range items {
		fmt.Fprintf(w, "%s,%s,%s,%s,%s,%s,%d,%d,%d,%d,%s\n",
			item.ID, item.DriverID, item.DriverName, item.BankName, item.AccountNumber, item.IFSC,
			item.Amount, item.TDS, item.Fees, item.Net, item.CreatedAt.Format(time.RFC3339))
	}
}

// HandleRetryPayout retries a FAILED payout request by moving it back to PENDING
func (h *PayoutHandler) HandleRetryPayout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_payout_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, "SELECT status FROM payout_requests WHERE id = $1 FOR UPDATE", id).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "payout_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if status != "FAILED" {
		http.Error(w, "payout_not_failed", http.StatusConflict)
		return
	}

	updateQuery := "UPDATE payout_requests SET status = 'PENDING', failure_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
	_, err = tx.Exec(ctx, updateQuery, id)
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
	_, _ = w.Write([]byte(`{"status":"PENDING"}`))
}

// HandleHoldPayout flags a payout request with HELD status and hold reason
func (h *PayoutHandler) HandleHoldPayout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_payout_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Reason == "" {
		http.Error(w, "invalid_reason_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, "SELECT status FROM payout_requests WHERE id = $1 FOR UPDATE", id).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "payout_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if status == "PAID" || status == "PROCESSING" {
		http.Error(w, "cannot_hold_processed_payout", http.StatusConflict)
		return
	}

	updateQuery := "UPDATE payout_requests SET status = 'HELD', hold_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
	_, err = tx.Exec(ctx, updateQuery, id, req.Reason)
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
	_, _ = w.Write([]byte(`{"status":"HELD"}`))
}

// HandleReleasePayout releases a HELD payout request back to PENDING status
func (h *PayoutHandler) HandleReleasePayout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_payout_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, "SELECT status FROM payout_requests WHERE id = $1 FOR UPDATE", id).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "payout_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	if status != "HELD" {
		http.Error(w, "payout_not_held", http.StatusConflict)
		return
	}

	updateQuery := "UPDATE payout_requests SET status = 'PENDING', hold_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
	_, err = tx.Exec(ctx, updateQuery, id)
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
	_, _ = w.Write([]byte(`{"status":"PENDING"}`))
}

// HandleSettlePayout records the bank result for a PROCESSING payout, closing the
// settlement state machine: PROCESSING -> PAID (with a bank reference) or
// PROCESSING -> FAILED (with a failure reason, after which it can be retried).
// Without this, a bank/NEFT failure left a payout stuck in PROCESSING forever —
// invisible to retry (which only handles FAILED) and to eligibility re-checks.
func (h *PayoutHandler) HandleSettlePayout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_payout_id", http.StatusBadRequest)
		return
	}

	var req struct {
		Status        string `json:"status"` // PAID | FAILED
		BankReference string `json:"bank_reference"`
		FailureReason string `json:"failure_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_settlement_payload", http.StatusBadRequest)
		return
	}

	newStatus := strings.ToUpper(strings.TrimSpace(req.Status))
	switch newStatus {
	case "PAID":
		if strings.TrimSpace(req.BankReference) == "" {
			http.Error(w, "bank_reference_required_for_paid", http.StatusBadRequest)
			return
		}
	case "FAILED":
		if strings.TrimSpace(req.FailureReason) == "" {
			http.Error(w, "failure_reason_required", http.StatusBadRequest)
			return
		}
	default:
		http.Error(w, "invalid_settlement_status", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx, "SELECT status FROM payout_requests WHERE id = $1 FOR UPDATE", id).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "payout_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_query_error", http.StatusInternalServerError)
		return
	}

	// Only a PROCESSING (exported-to-bank) payout can be settled. This also makes the
	// endpoint idempotent: a duplicate PAID/FAILED callback finds a non-PROCESSING row
	// and is rejected instead of double-applying.
	if status != "PROCESSING" {
		http.Error(w, "payout_not_processing", http.StatusConflict)
		return
	}

	if newStatus == "PAID" {
		_, err = tx.Exec(ctx,
			"UPDATE payout_requests SET status = 'PAID', bank_reference = $2, failure_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
			id, strings.TrimSpace(req.BankReference))
	} else {
		_, err = tx.Exec(ctx,
			"UPDATE payout_requests SET status = 'FAILED', failure_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
			id, strings.TrimSpace(req.FailureReason))
	}
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
	_, _ = fmt.Fprintf(w, `{"status":%q}`, newStatus)
}
