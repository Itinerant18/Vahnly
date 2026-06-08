package http

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// roadFactor approximates road-network distance from the straight-line (geodesic)
// distance between pickup and dropoff. The admin service has no routing engine, so
// the expected distance is ST_Distance * roadFactor rather than a true CH route.
const odoRoadFactor = 1.3

// odoTolerancePct is the |variance| beyond which a trip is flagged for audit.
const odoTolerancePct = 15.0

// odoExtraKmRatePaise is the provisional per-km rate used to size the corrective
// fare adjustment when mileage variance is flagged (no fare engine in this service).
const odoExtraKmRatePaise = 1200 // ₹12.00 / km

type OdometerHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewOdometerHandler(db *pgxpool.Pool, logger *log.Logger) *OdometerHandler {
	return &OdometerHandler{db: db, logger: logger}
}

func odoJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type odoCheckpoint struct {
	CheckpointType string    `json:"checkpoint_type"`
	OdometerValue  int       `json:"odometer_value"`
	FuelPercentage int       `json:"fuel_percentage"`
	PhotoURL       string    `json:"photo_url"`
	CapturedAt     time.Time `json:"captured_at"`
}

type odoAudit struct {
	OrderID         string         `json:"order_id"`
	Status          string         `json:"status"`
	FinancialStatus string         `json:"financial_status"`
	ExpectedKm      float64        `json:"expected_km"`
	RoadFactor      float64        `json:"road_factor"`
	TolerancePct    float64        `json:"tolerance_pct"`
	HasBoth         bool           `json:"has_both"`
	ReportedKm      *int           `json:"reported_km,omitempty"`
	VariancePct     *float64       `json:"variance_pct,omitempty"`
	IsFlagged       bool           `json:"is_flagged"`
	Start           *odoCheckpoint `json:"start"`
	End             *odoCheckpoint `json:"end"`
}

func round2(x float64) float64 { return math.Round(x*100) / 100 }

// computeAudit loads the order's expected distance and its checkpoints, then derives
// the reported mileage and variance. Returns (audit, found=false) when the order
// does not exist or the id is malformed.
func (h *OdometerHandler) computeAudit(ctx context.Context, orderID string) (*odoAudit, bool) {
	var status, financialStatus string
	var straightKm float64
	err := h.db.QueryRow(ctx,
		`SELECT status::text, financial_status, ST_Distance(pickup_location, dropoff_location) / 1000.0 FROM orders WHERE id = $1`,
		orderID).Scan(&status, &financialStatus, &straightKm)
	if err != nil {
		return nil, false
	}

	expectedKm := straightKm * odoRoadFactor
	audit := &odoAudit{
		OrderID:         orderID,
		Status:          status,
		FinancialStatus: financialStatus,
		ExpectedKm:      round2(expectedKm),
		RoadFactor:      odoRoadFactor,
		TolerancePct:    odoTolerancePct,
	}

	rows, err := h.db.Query(ctx,
		`SELECT checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at
		   FROM trip_odometer_checkpoints WHERE order_id = $1`, orderID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var c odoCheckpoint
			if err := rows.Scan(&c.CheckpointType, &c.OdometerValue, &c.FuelPercentage, &c.PhotoURL, &c.CapturedAt); err != nil {
				continue
			}
			cc := c
			switch c.CheckpointType {
			case "START":
				audit.Start = &cc
			case "END":
				audit.End = &cc
			}
		}
	}

	if audit.Start != nil && audit.End != nil {
		audit.HasBoth = true
		reported := audit.End.OdometerValue - audit.Start.OdometerValue
		audit.ReportedKm = &reported
		if expectedKm > 0 {
			v := round2((float64(reported) - expectedKm) / expectedKm * 100)
			audit.VariancePct = &v
			audit.IsFlagged = math.Abs(v) > odoTolerancePct
		}
	}
	return audit, true
}

func (h *OdometerHandler) HandleGetOdometerAudit(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	audit, found := h.computeAudit(ctx, r.PathValue("id"))
	if !found {
		http.Error(w, "order_not_found", http.StatusNotFound)
		return
	}
	odoJSON(w, http.StatusOK, audit)
}

func (h *OdometerHandler) HandlePatchOdometerAudit(w http.ResponseWriter, r *http.Request) {
	if !methodAllowed(w, r, http.MethodPatch) {
		return
	}

	adminRole := r.Header.Get("X-Admin-Role")
	if adminRole != "SUPER_ADMIN" && adminRole != "FINANCIAL_AUDITOR" {
		http.Error(w, "insufficient_financial_clearance_tokens", http.StatusForbidden)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	orderID := r.PathValue("id")
	var req struct {
		CheckpointType string `json:"checkpoint_type"`
		OdometerValue  int    `json:"odometer_value"`
		FuelPercentage *int   `json:"fuel_percentage"`
		Reason         string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if (req.CheckpointType != "START" && req.CheckpointType != "END") || req.OdometerValue <= 0 {
		http.Error(w, "invalid_odometer_parameters", http.StatusUnprocessableEntity)
		return
	}

	var err error
	var tag interface{ RowsAffected() int64 }
	if req.FuelPercentage != nil {
		t, e := h.db.Exec(ctx,
			`UPDATE trip_odometer_checkpoints SET odometer_value = $1, fuel_percentage = $2 WHERE order_id = $3 AND checkpoint_type = $4`,
			req.OdometerValue, *req.FuelPercentage, orderID, req.CheckpointType)
		tag, err = t, e
	} else {
		t, e := h.db.Exec(ctx,
			`UPDATE trip_odometer_checkpoints SET odometer_value = $1 WHERE order_id = $2 AND checkpoint_type = $3`,
			req.OdometerValue, orderID, req.CheckpointType)
		tag, err = t, e
	}
	if err != nil {
		h.logger.Printf("[ODOMETER_PATCH_FAILURE] order %s: %v", orderID, err)
		http.Error(w, "odometer_update_failed", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "checkpoint_not_found", http.StatusNotFound)
		return
	}

	// Recompute variance, then run the in-process FareEngine reconciliation hook.
	audit, found := h.computeAudit(ctx, orderID)
	reviewTriggered := false
	if found && audit.HasBoth {
		reviewTriggered = h.reconcileFinancials(ctx, orderID, audit)
	}

	// Attribute the manual correction to the acting admin (sensitive: it shifts the
	// extra-km fare and can place the trip under financial review).
	adminID, _ := middleware.GetUserIDFromContext(ctx)
	adminEmail := r.Header.Get("X-Admin-Email")
	reviewNote := ""
	if reviewTriggered {
		reviewNote = " -> order moved to FINANCIAL_REVIEW_REQUIRED, driver payout held, corrective ledger entry posted"
	}
	h.recordAuditLog(ctx, adminID, adminEmail, "ODOMETER_ADJUSTMENT",
		fmt.Sprintf("Admin (%s) set %s odometer to %d km for order %s. Reason: %s%s",
			adminRole, req.CheckpointType, req.OdometerValue, orderID, req.Reason, reviewNote), getClientIP(r))

	if !found {
		odoJSON(w, http.StatusOK, map[string]string{"status": "updated"})
		return
	}
	// Reflect the financial state mutated above without a second round-trip.
	if reviewTriggered {
		audit.FinancialStatus = "REVIEW_REQUIRED"
	} else if audit.HasBoth {
		audit.FinancialStatus = "CLEARED"
	}
	odoJSON(w, http.StatusOK, audit)
}

// reconcileFinancials is the in-process FareEngine hook. When a mileage variance is
// flagged it: (1) moves the order to FINANCIAL_REVIEW_REQUIRED, (2) posts a balanced
// (net-zero) CORRECTIVE_ADJUSTMENT ledger pair — never editing existing rows, keeping
// the double-entry trail immutable, and (3) places the order's driver on payout hold,
// reusing the existing drivers.payout_hold guard enforced at payout approval. Within
// tolerance, it clears the order back to CLEARED (auto-reconciled). Returns whether a
// review hold was triggered.
func (h *OdometerHandler) reconcileFinancials(ctx context.Context, orderID string, audit *odoAudit) bool {
	if !audit.IsFlagged {
		_, _ = h.db.Exec(ctx, `UPDATE orders SET financial_status = 'CLEARED' WHERE id = $1`, orderID)
		return false
	}

	var cityPrefix string
	var driverID *string
	if err := h.db.QueryRow(ctx,
		`SELECT city_prefix, assigned_driver_id::text FROM orders WHERE id = $1`, orderID).
		Scan(&cityPrefix, &driverID); err != nil {
		h.logger.Printf("[FARE_HOOK] lookup failed for order %s: %v", orderID, err)
		return false
	}

	deltaKm := float64(*audit.ReportedKm) - audit.ExpectedKm
	correctivePaise := int64(math.Round(math.Abs(deltaKm) * odoExtraKmRatePaise))
	if correctivePaise <= 0 {
		correctivePaise = 1 // keep a non-zero, auditable corrective record
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		h.logger.Printf("[FARE_HOOK] tx begin failed for order %s: %v", orderID, err)
		return false
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE orders SET financial_status = 'REVIEW_REQUIRED' WHERE id = $1`, orderID); err != nil {
		h.logger.Printf("[FARE_HOOK] status update failed for order %s: %v", orderID, err)
		return false
	}

	// Balanced compensating pair: extra fare provisionally owed customer -> driver.
	desc := fmt.Sprintf("[CORRECTIVE_ADJUSTMENT PENDING_REVIEW] mileage variance %.1f%% (%.1f km delta) on order %s",
		*audit.VariancePct, deltaKm, orderID)
	// regional_settlement_zone is NOT NULL (migration 000032); mirror the city_prefix
	// backfill convention ($2 -> both columns) used by the rest of the ledger writers.
	insert := `INSERT INTO financial_ledger_entries (order_id, city_prefix, regional_settlement_zone, account_type, entry_type, amount_paise, description)
	           VALUES ($1, $2, $2, 'CORRECTIVE_ADJUSTMENT', $3, $4, $5)`
	if _, err := tx.Exec(ctx, insert, orderID, cityPrefix, "DEBIT", correctivePaise, desc); err != nil {
		h.logger.Printf("[FARE_HOOK] debit insert failed for order %s: %v", orderID, err)
		return false
	}
	if _, err := tx.Exec(ctx, insert, orderID, cityPrefix, "CREDIT", correctivePaise, desc); err != nil {
		h.logger.Printf("[FARE_HOOK] credit insert failed for order %s: %v", orderID, err)
		return false
	}

	if driverID != nil && *driverID != "" {
		holdReason := fmt.Sprintf("Odometer variance %.1f%% under financial review (order %s)", *audit.VariancePct, orderID)
		if _, err := tx.Exec(ctx,
			`UPDATE drivers SET payout_hold = true, payout_hold_reason = $1 WHERE id = $2`,
			holdReason, *driverID); err != nil {
			h.logger.Printf("[FARE_HOOK] payout hold failed for driver %s: %v", *driverID, err)
			return false
		}
	}

	if err := tx.Commit(ctx); err != nil {
		h.logger.Printf("[FARE_HOOK] commit failed for order %s: %v", orderID, err)
		return false
	}
	return true
}

func (h *OdometerHandler) recordAuditLog(ctx context.Context, adminID, email, action, details, ip string) {
	var idVal interface{} = adminID
	if adminID == "" {
		idVal = "00000000-0000-0000-0000-000000000000"
	}
	_, _ = h.db.Exec(ctx,
		`INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)`,
		idVal, email, action, details, ip)
}
