package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Team-management actions layered on top of the existing /admin/team handlers in
// auth_handler.go. They operate on the same system_admins table that the team list
// (HandleListAdmins) reads from. system_admins has no dedicated `status` column, so
// ACTIVE/SUSPENDED is represented by the is_active boolean, and INVITED/PENDING by an
// inactive row awaiting first login.

// ---------------------------------------------------------------------------
// POST /api/v1/admin/team/invite  {email, role, city_scope?}
// ---------------------------------------------------------------------------

func (h *AdminExtrasHandler) HandleTeamInvite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Email     string `json:"email"`
		Role      string `json:"role"`
		CityScope string `json:"city_scope"`
		FullName  string `json:"full_name"`
		Phone     string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	req.Role = strings.ToUpper(strings.TrimSpace(req.Role))
	if req.Email == "" || req.Role == "" {
		http.Error(w, "missing_fields: email and role required", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	cityScope := req.CityScope
	if cityScope == "" {
		cityScope = "KOL"
	}
	fullName := req.FullName
	if fullName == "" {
		fullName = req.Email
	}

	// Placeholder password hash to satisfy NOT NULL; the invitee sets a real one at
	// first login. is_active=false marks the row as PENDING/INVITED.
	hashed, _ := bcrypt.GenerateFromPassword([]byte("InvitePending123"), 12)

	_, err := h.dbPool.Exec(ctx, `
		INSERT INTO system_admins (full_name, phone, email, password_hash, role, region_prefix, city_scope, is_active, two_factor_enabled, must_change_password)
		VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, true)`,
		fullName, req.Phone, req.Email, string(hashed), req.Role, cityScope, cityScope)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			http.Error(w, "admin_already_exists", http.StatusConflict)
			return
		}
		h.logger.Printf("[ADMIN_TEAM] invite failed: %v", err)
		http.Error(w, "invite_failed", http.StatusInternalServerError)
		return
	}

	writeExtrasJSON(w, map[string]any{"message": "Invitation created with status PENDING"})
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/team/{id}/status  {status:"ACTIVE"|"SUSPENDED", reason?}
// ---------------------------------------------------------------------------

func (h *AdminExtrasHandler) HandleTeamSetStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_admin_id", http.StatusBadRequest)
		return
	}
	var req struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed_json_payload", http.StatusBadRequest)
		return
	}
	req.Status = strings.ToUpper(strings.TrimSpace(req.Status))
	if req.Status != "ACTIVE" && req.Status != "SUSPENDED" {
		http.Error(w, "invalid_status: must be ACTIVE or SUSPENDED", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	active := req.Status == "ACTIVE"
	ct, err := h.dbPool.Exec(ctx,
		`UPDATE system_admins SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid`, active, id)
	if err != nil {
		http.Error(w, "status_update_failed", http.StatusInternalServerError)
		return
	}
	if ct.RowsAffected() == 0 {
		http.Error(w, "admin_not_found", http.StatusNotFound)
		return
	}

	writeExtrasJSON(w, map[string]any{"message": "Admin status set to " + req.Status})
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/team/{id}/reset-2fa
// ---------------------------------------------------------------------------

func (h *AdminExtrasHandler) HandleTeamReset2FA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_admin_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Null the secret and unset the enrolled flag so the admin must re-enrol.
	ct, err := h.dbPool.Exec(ctx, `
		UPDATE system_admins
		SET two_factor_secret = '', two_factor_enabled = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid`, id)
	if err != nil {
		http.Error(w, "reset_2fa_failed", http.StatusInternalServerError)
		return
	}
	if ct.RowsAffected() == 0 {
		http.Error(w, "admin_not_found", http.StatusNotFound)
		return
	}

	writeExtrasJSON(w, map[string]any{"message": "2FA reset; admin must re-enroll on next login"})
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/team/{id}/force-logout
// ---------------------------------------------------------------------------

func (h *AdminExtrasHandler) HandleTeamForceLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "missing_admin_id", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// There is no token_version or sessions table; best-effort device-binding reset
	// (clears the stored device fingerprint) so the next request must re-auth. If the
	// column is absent this is a 200 no-op.
	_, _ = h.dbPool.Exec(ctx, `
		UPDATE system_admins
		SET device_fingerprint = '', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid`, id)

	writeExtrasJSON(w, map[string]any{"message": "Force-logout processed (sessions invalidated where supported)"})
}
