package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type FranchiseHandler struct {
	db     *pgxpool.Pool
	logger *log.Logger
}

func NewFranchiseHandler(db *pgxpool.Pool, logger *log.Logger) *FranchiseHandler {
	return &FranchiseHandler{db: db, logger: logger}
}

func franchJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (h *FranchiseHandler) HandleGetTenants(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type Tenant struct {
		ID              string     `json:"id"`
		Name            string     `json:"name"`
		Slug            string     `json:"slug"`
		ContactEmail    string     `json:"contact_email"`
		ContactPhone    string     `json:"contact_phone"`
		AllowedCities   []string   `json:"allowed_cities"`
		RevenueSharePct float64    `json:"revenue_share_pct"`
		Status          string     `json:"status"`
		ActiveDrivers   int        `json:"active_drivers"`
		ActiveRiders    int        `json:"active_riders"`
		CreatedAt       time.Time  `json:"created_at"`
		SuspendedAt     *time.Time `json:"suspended_at,omitempty"`
	}

	rows, err := h.db.Query(ctx, `SELECT id, name, slug, contact_email, contact_phone, allowed_cities, revenue_share_pct, status, active_drivers, active_riders, created_at, suspended_at FROM tenants ORDER BY created_at DESC`)
	if err != nil {
		h.logger.Printf("GetTenants: %v", err)
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Tenant{}
	for rows.Next() {
		var t Tenant
		if err := rows.Scan(&t.ID, &t.Name, &t.Slug, &t.ContactEmail, &t.ContactPhone, &t.AllowedCities, &t.RevenueSharePct, &t.Status, &t.ActiveDrivers, &t.ActiveRiders, &t.CreatedAt, &t.SuspendedAt); err != nil {
			continue
		}
		if t.AllowedCities == nil {
			t.AllowedCities = []string{}
		}
		result = append(result, t)
	}
	franchJSON(w, http.StatusOK, map[string]any{"tenants": result, "count": len(result)})
}

func (h *FranchiseHandler) HandleUpsertTenant(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		Name            string   `json:"name"`
		Slug            string   `json:"slug"`
		ContactEmail    string   `json:"contact_email"`
		ContactPhone    string   `json:"contact_phone"`
		AllowedCities   []string `json:"allowed_cities"`
		RevenueSharePct float64  `json:"revenue_share_pct"`
		Status          string   `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	if id != "" {
		_, err := h.db.Exec(ctx, `UPDATE tenants SET name=$1, contact_email=$2, contact_phone=$3, allowed_cities=$4, revenue_share_pct=$5, status=$6, suspended_at=CASE WHEN $6='SUSPENDED' THEN NOW() WHEN $6='ACTIVE' THEN NULL ELSE suspended_at END WHERE id=$7`,
			body.Name, body.ContactEmail, body.ContactPhone, body.AllowedCities, body.RevenueSharePct, body.Status, id)
		if err != nil {
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		franchJSON(w, http.StatusOK, map[string]string{"id": id, "status": "updated"})
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO tenants (name, slug, contact_email, contact_phone, allowed_cities, revenue_share_pct, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		body.Name, body.Slug, body.ContactEmail, body.ContactPhone, body.AllowedCities, body.RevenueSharePct, body.Status).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	franchJSON(w, http.StatusCreated, map[string]string{"id": newID})
}

func (h *FranchiseHandler) HandleGetTenantOperators(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	type Operator struct {
		ID         string    `json:"id"`
		TenantID   string    `json:"tenant_id"`
		TenantName string    `json:"tenant_name"`
		AdminEmail string    `json:"admin_email"`
		Role       string    `json:"role"`
		IsActive   bool      `json:"is_active"`
		CreatedAt  time.Time `json:"created_at"`
	}

	tenantID := r.URL.Query().Get("tenant_id")
	args := []any{}
	where := ""
	if tenantID != "" {
		where = "WHERE o.tenant_id = $1"
		args = append(args, tenantID)
	}

	rows, err := h.db.Query(ctx, `SELECT o.id, o.tenant_id, t.name, o.admin_email, o.role, o.is_active, o.created_at FROM tenant_operators o JOIN tenants t ON t.id=o.tenant_id `+where+` ORDER BY t.name, o.admin_email`, args...)
	if err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := []Operator{}
	for rows.Next() {
		var op Operator
		if err := rows.Scan(&op.ID, &op.TenantID, &op.TenantName, &op.AdminEmail, &op.Role, &op.IsActive, &op.CreatedAt); err != nil {
			continue
		}
		result = append(result, op)
	}
	franchJSON(w, http.StatusOK, map[string]any{"operators": result})
}

func (h *FranchiseHandler) HandleAddTenantOperator(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var body struct {
		TenantID   string `json:"tenant_id"`
		AdminEmail string `json:"admin_email"`
		Role       string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	var newID string
	err := h.db.QueryRow(ctx, `INSERT INTO tenant_operators (tenant_id, admin_email, role) VALUES ($1,$2,$3) RETURNING id`,
		body.TenantID, body.AdminEmail, body.Role).Scan(&newID)
	if err != nil {
		http.Error(w, "insert failed", http.StatusInternalServerError)
		return
	}
	franchJSON(w, http.StatusCreated, map[string]string{"id": newID})
}
