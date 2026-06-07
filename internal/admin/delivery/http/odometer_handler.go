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
	OrderID      string         `json:"order_id"`
	Status       string         `json:"status"`
	ExpectedKm   float64        `json:"expected_km"`
	RoadFactor   float64        `json:"road_factor"`
	TolerancePct float64        `json:"tolerance_pct"`
	HasBoth      bool           `json:"has_both"`
	ReportedKm   *int           `json:"reported_km,omitempty"`
	VariancePct  *float64       `json:"variance_pct,omitempty"`
	IsFlagged    bool           `json:"is_flagged"`
	Start        *odoCheckpoint `json:"start"`
	End          *odoCheckpoint `json:"end"`
}

func round2(x float64) float64 { return math.Round(x*100) / 100 }

// computeAudit loads the order's expected distance and its checkpoints, then derives
// the reported mileage and variance. Returns (audit, found=false) when the order
// does not exist or the id is malformed.
func (h *OdometerHandler) computeAudit(ctx context.Context, orderID string) (*odoAudit, bool) {
	var status string
	var straightKm float64
	err := h.db.QueryRow(ctx,
		`SELECT status::text, ST_Distance(pickup_location, dropoff_location) / 1000.0 FROM orders WHERE id = $1`,
		orderID).Scan(&status, &straightKm)
	if err != nil {
		return nil, false
	}

	expectedKm := straightKm * odoRoadFactor
	audit := &odoAudit{
		OrderID:      orderID,
		Status:       status,
		ExpectedKm:   round2(expectedKm),
		RoadFactor:   odoRoadFactor,
		TolerancePct: odoTolerancePct,
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

	// Attribute the manual correction to the acting admin (sensitive: it can shift
	// the extra-km fare). A downstream ledger re-reconciliation hook can be wired
	// here once the fare engine exposes an in-process trigger.
	adminID, _ := middleware.GetUserIDFromContext(ctx)
	adminEmail := r.Header.Get("X-Admin-Email")
	h.recordAuditLog(ctx, adminID, adminEmail, "ODOMETER_ADJUSTMENT",
		fmt.Sprintf("Admin (%s) set %s odometer to %d km for order %s. Reason: %s",
			adminRole, req.CheckpointType, req.OdometerValue, orderID, req.Reason), getClientIP(r))

	audit, found := h.computeAudit(ctx, orderID)
	if !found {
		odoJSON(w, http.StatusOK, map[string]string{"status": "updated"})
		return
	}
	odoJSON(w, http.StatusOK, audit)
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
