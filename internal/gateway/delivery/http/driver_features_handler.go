package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DriverFeaturesHandler backs the driver-account vehicles, wallet, and training screens
// (FEAT-002). Every endpoint is scoped to the authenticated driver via requireDriverIdentity
// — identity is never taken from a client header.
type DriverFeaturesHandler struct {
	dbPool *pgxpool.Pool
}

func NewDriverFeaturesHandler(dbPool *pgxpool.Pool) *DriverFeaturesHandler {
	return &DriverFeaturesHandler{dbPool: dbPool}
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

type driverVehicle struct {
	ID              string `json:"id"`
	Make            string `json:"make"`
	Model           string `json:"model"`
	LicensePlate    string `json:"license_plate"`
	Transmission    string `json:"transmission"`
	RCStatus        string `json:"rc_status"`
	InsuranceStatus string `json:"insurance_status"`
	PUCStatus       string `json:"puc_status"`
}

// GET /api/v1/driver-account/vehicles
func (h *DriverFeaturesHandler) ListVehicles(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, make, model, license_plate, transmission, rc_status, insurance_status, puc_status
		FROM driver_vehicles
		WHERE driver_id = $1::uuid AND is_active
		ORDER BY created_at DESC
	`, driverID)
	if err != nil {
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vehicles := make([]driverVehicle, 0)
	for rows.Next() {
		var v driverVehicle
		if err := rows.Scan(&v.ID, &v.Make, &v.Model, &v.LicensePlate, &v.Transmission, &v.RCStatus, &v.InsuranceStatus, &v.PUCStatus); err == nil {
			vehicles = append(vehicles, v)
		}
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{"vehicles": vehicles})
}

// POST /api/v1/driver-account/vehicles
func (h *DriverFeaturesHandler) AddVehicle(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	var req struct {
		Make         string `json:"make"`
		Model        string `json:"model"`
		LicensePlate string `json:"license_plate"`
		Transmission string `json:"transmission"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Make = strings.TrimSpace(req.Make)
	req.Model = strings.TrimSpace(req.Model)
	req.LicensePlate = strings.ToUpper(strings.TrimSpace(req.LicensePlate))
	if req.Make == "" || req.Model == "" || req.LicensePlate == "" {
		http.Error(w, "make_model_plate_required", http.StatusUnprocessableEntity)
		return
	}
	transmission := strings.ToUpper(strings.TrimSpace(req.Transmission))
	if transmission != "MANUAL" && transmission != "AUTOMATIC" {
		transmission = "AUTOMATIC"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var id string
	err := h.dbPool.QueryRow(ctx, `
		INSERT INTO driver_vehicles (driver_id, make, model, license_plate, transmission)
		VALUES ($1::uuid, $2, $3, $4, $5)
		RETURNING id::text
	`, driverID, req.Make, req.Model, req.LicensePlate, transmission).Scan(&id)
	if err != nil {
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusCreated, map[string]interface{}{"id": id, "status": "registered"})
}

// DELETE /api/v1/driver-account/vehicles/{id}
func (h *DriverFeaturesHandler) DeleteVehicle(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_vehicle_id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// Soft-delete, scoped to the owning driver so one driver cannot remove another's record.
	tag, err := h.dbPool.Exec(ctx, `
		UPDATE driver_vehicles SET is_active = FALSE, updated_at = NOW()
		WHERE id = $1::uuid AND driver_id = $2::uuid AND is_active
	`, id, driverID)
	if err != nil {
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "vehicle_not_found", http.StatusNotFound)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{"status": "removed"})
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

// GET /api/v1/driver-account/wallet
func (h *DriverFeaturesHandler) GetWallet(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var balance int64
	// COALESCE so a driver with no wallet row yet reports a zero balance instead of erroring.
	// Column is available_balance — the old balance_paise reference silently errored and
	// always reported 0.
	_ = h.dbPool.QueryRow(ctx,
		`SELECT COALESCE((SELECT available_balance FROM driver_wallets WHERE driver_id = $1::uuid), 0)`,
		driverID).Scan(&balance)

	type txn struct {
		ID          string    `json:"id"`
		AmountPaise int64     `json:"amount_paise"`
		EntryType   string    `json:"entry_type"`
		Description string    `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}
	transactions := make([]txn, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT id::text, amount_paise, entry_type, description, created_at
		FROM driver_wallet_transactions
		WHERE driver_id = $1::uuid
		ORDER BY created_at DESC
		LIMIT 50
	`, driverID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var t txn
			if err := rows.Scan(&t.ID, &t.AmountPaise, &t.EntryType, &t.Description, &t.CreatedAt); err == nil {
				transactions = append(transactions, t)
			}
		}
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"balance_paise": balance,
		"transactions":  transactions,
	})
}

// ─── Training ─────────────────────────────────────────────────────────────────

// GET /api/v1/driver-account/training
func (h *DriverFeaturesHandler) ListTraining(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	type module struct {
		ID            string `json:"id"`
		Title         string `json:"title"`
		DurationLabel string `json:"duration_label"`
		ModuleType    string `json:"module_type"`
		Status        string `json:"status"`
		Score         *int   `json:"score"`
	}
	modules := make([]module, 0)
	rows, err := h.dbPool.Query(ctx, `
		SELECT m.id::text, m.title, m.duration_label, m.module_type,
		       COALESCE(p.status, 'NOT_STARTED'), p.score
		FROM training_modules m
		LEFT JOIN driver_training_progress p
		       ON p.module_id = m.id AND p.driver_id = $1::uuid
		WHERE m.is_active
		ORDER BY m.display_order, m.title
	`, driverID)
	if err != nil {
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m module
		if err := rows.Scan(&m.ID, &m.Title, &m.DurationLabel, &m.ModuleType, &m.Status, &m.Score); err == nil {
			modules = append(modules, m)
		}
	}
	// Training catalogue is near-static and per-driver; allow short private caching.
	w.Header().Set("Cache-Control", "private, max-age=300")
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{"modules": modules})
}

// POST /api/v1/driver-account/training/{id}/submit
func (h *DriverFeaturesHandler) SubmitTrainingQuiz(w http.ResponseWriter, r *http.Request) {
	driverID, ok := requireDriverIdentity(w, r)
	if !ok {
		return
	}
	moduleID := r.PathValue("id")
	if moduleID == "" {
		http.Error(w, "missing_module_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Score int `json:"score"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	if req.Score < 0 || req.Score > 100 {
		http.Error(w, "invalid_score", http.StatusUnprocessableEntity)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// Pass/fail is graded against the module's own threshold, server-side.
	var threshold int
	if err := h.dbPool.QueryRow(ctx,
		`SELECT pass_threshold FROM training_modules WHERE id = $1::uuid AND is_active`,
		moduleID).Scan(&threshold); err != nil {
		http.Error(w, "module_not_found", http.StatusNotFound)
		return
	}
	status := "IN_PROGRESS"
	if req.Score >= threshold {
		status = "COMPLETED"
	}

	_, err := h.dbPool.Exec(ctx, `
		INSERT INTO driver_training_progress (driver_id, module_id, score, status, completed_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, CASE WHEN $4 = 'COMPLETED' THEN NOW() ELSE NULL END)
		ON CONFLICT (driver_id, module_id) DO UPDATE
		SET score = EXCLUDED.score, status = EXCLUDED.status, completed_at = EXCLUDED.completed_at
	`, driverID, moduleID, req.Score, status)
	if err != nil {
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{"status": status, "score": req.Score})
}
