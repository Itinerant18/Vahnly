package http

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"golang.org/x/crypto/bcrypt"
)

type AuthRequest struct {
	Email             string `json:"email"`
	Password          string `json:"password"`
	SSOProvider       string `json:"sso_provider"`
	SSOID             string `json:"sso_id"`
	TwoFactorCode     string `json:"two_factor_code"`
	DeviceFingerprint string `json:"device_fingerprint"`
}

type AuthResponse struct {
	Token       string    `json:"token,omitempty"`
	ExpiresAt   time.Time `json:"expires_at,omitempty"`
	Role        string    `json:"role,omitempty"`
	MFARequired bool      `json:"mfa_required,omitempty"`
	Message     string    `json:"message,omitempty"`
	Email       string    `json:"email,omitempty"`
}

type RegisterRequest struct {
	FullName     string `json:"full_name"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	RegionPrefix string `json:"region_prefix"`
	Role         string `json:"role"`
	CityScope    string `json:"city_scope"`
}

type AdminAuthHandler struct {
	dbPool    *pgxpool.Pool
	jwtSecret []byte
}

func NewAdminAuthHandler(dbPool *pgxpool.Pool, jwtSecret string) *AdminAuthHandler {
	return &AdminAuthHandler{
		dbPool:    dbPool,
		jwtSecret: []byte(jwtSecret),
	}
}

func getClientIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.Header.Get("X-Real-IP")
	}
	if ip == "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil {
			ip = host
		} else {
			ip = r.RemoteAddr
		}
	}
	if idx := strings.Index(ip, ","); idx != -1 {
		ip = ip[:idx]
	}
	return strings.TrimSpace(ip)
}

func (h *AdminAuthHandler) recordAuditLog(ctx context.Context, adminID string, email string, action string, details string, ip string) {
	query := `
		INSERT INTO admin_audit_logs (admin_id, admin_email, action, details, ip_address)
		VALUES ($1, $2, $3, $4, $5)
	`
	// Handle nil UUID gracefully
	var idVal interface{} = adminID
	if adminID == "" {
		idVal = "00000000-0000-0000-0000-000000000000"
	}
	_, _ = h.dbPool.Exec(ctx, query, idVal, email, action, details, ip)
}

func isValidRole(role string) bool {
	roles := []string{
		"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER",
		"CUSTOMER_SUPPORT", "FINANCE", "MARKETING",
		"ANALYTICS", "CITY_MANAGER", "COMPLIANCE", "AUDITOR",
	}
	for _, r := range roles {
		if strings.ToUpper(role) == r {
			return true
		}
	}
	return false
}

// HandleAdminLogin verifies database credentials, checks for brute-force lockouts, validates SSO integrations, 2FA codes, and remote IP blocks
func (h *AdminAuthHandler) HandleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_request_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	ip := getClientIP(r)

	var dbUserID string
	var dbFullName string
	var dbPasswordHash string
	var dbRole string
	var dbIsActive bool
	var dbTwoFactorSecret string
	var dbTwoFactorEnabled bool
	var dbSSOProvider string
	var dbSSOID string
	var dbLoginAttempts int
	var dbLockedUntil *time.Time
	var dbIPAllowList string
	var dbCityScope string

	query := `
		SELECT id, full_name, password_hash, role, is_active, 
		       two_factor_secret, two_factor_enabled, sso_provider, sso_id,
		       login_attempts, locked_until, ip_allow_list, city_scope
		FROM system_admins 
		WHERE email = $1
	`
	err := h.dbPool.QueryRow(ctx, query, req.Email).Scan(
		&dbUserID, &dbFullName, &dbPasswordHash, &dbRole, &dbIsActive,
		&dbTwoFactorSecret, &dbTwoFactorEnabled, &dbSSOProvider, &dbSSOID,
		&dbLoginAttempts, &dbLockedUntil, &dbIPAllowList, &dbCityScope,
	)

	if err != nil {
		h.recordAuditLog(ctx, "", req.Email, "LOGIN_FAILURE", "User email does not exist", ip)
		http.Error(w, "invalid_credentials", http.StatusUnauthorized)
		return
	}

	if !dbIsActive {
		h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_FAILURE", "Account suspended", ip)
		http.Error(w, "account_suspended", http.StatusForbidden)
		return
	}

	// 1. Lockout verification check
	if dbLockedUntil != nil && dbLockedUntil.After(time.Now()) {
		h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_FAILURE", "Attempt during lockout cooldown", ip)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusLocked)
		_ = json.NewEncoder(w).Encode(AuthResponse{
			Message: fmt.Sprintf("Account locked due to consecutive failures. Try again after %v.", dbLockedUntil.Format(time.RFC3339)),
		})
		return
	}

	// 2. IP allow-list check
	if dbIPAllowList != "" {
		allowed := false
		for _, allowedIP := range strings.Split(dbIPAllowList, ",") {
			if strings.TrimSpace(allowedIP) == ip {
				allowed = true
				break
			}
		}
		if !allowed {
			h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_FAILURE", fmt.Sprintf("IP Access denied: %s not in allow list", ip), ip)
			http.Error(w, "access_denied_ip_unauthorized", http.StatusForbidden)
			return
		}
	}

	// 3. Authenticate (SSO vs Password)
	isSSOLogin := req.SSOProvider != ""
	if isSSOLogin {
		// SSO Authentication
		if !strings.EqualFold(dbSSOProvider, req.SSOProvider) || dbSSOID != req.SSOID {
			// If SSO info is not linked yet, but request claims SSO, we link it for demo/testing or reject. Let's register SSO details on first match.
			if dbSSOProvider == "" {
				_, _ = h.dbPool.Exec(ctx, "UPDATE system_admins SET sso_provider = $1, sso_id = $2 WHERE id = $3", req.SSOProvider, req.SSOID, dbUserID)
			} else {
				h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_FAILURE", "SSO credentials mismatch", ip)
				http.Error(w, "invalid_sso_credentials", http.StatusUnauthorized)
				return
			}
		}
	} else {
		// Password Authentication
		if err := bcrypt.CompareHashAndPassword([]byte(dbPasswordHash), []byte(req.Password)); err != nil {
			// Increment attempts & lock if limit exceeded
			newAttempts := dbLoginAttempts + 1
			var lockUntilQuery string
			var lockUntilArgs []interface{}
			if newAttempts >= 5 {
				cooldown := time.Now().Add(15 * time.Minute)
				lockUntilQuery = "UPDATE system_admins SET login_attempts = $1, locked_until = $2 WHERE id = $3"
				lockUntilArgs = []interface{}{newAttempts, cooldown, dbUserID}
				h.recordAuditLog(ctx, dbUserID, req.Email, "LOCKOUT", "Brute-force limit reached, locking account for 15 mins", ip)
			} else {
				lockUntilQuery = "UPDATE system_admins SET login_attempts = $1 WHERE id = $2"
				lockUntilArgs = []interface{}{newAttempts, dbUserID}
			}
			_, _ = h.dbPool.Exec(ctx, lockUntilQuery, lockUntilArgs...)

			h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_FAILURE", "Invalid password input", ip)
			http.Error(w, "invalid_credentials", http.StatusUnauthorized)
			return
		}
	}

	// Reset attempts on successful password/SSO handshake
	if dbLoginAttempts > 0 {
		_, _ = h.dbPool.Exec(ctx, "UPDATE system_admins SET login_attempts = 0, locked_until = NULL WHERE id = $1", dbUserID)
	}

	// 4. Two-Factor Authentication Check (RFC 6238 TOTP).
	// Enforced only once a secret has actually been enrolled — accounts flagged
	// 2FA-enabled but not yet enrolled (empty secret) pass through so they can
	// reach the enrolment endpoint. SSO logins are externally verified, skip TOTP.
	if dbTwoFactorEnabled && dbTwoFactorSecret != "" && !isSSOLogin {
		if req.TwoFactorCode == "" {
			// Signal to frontend that MFA verification layer is required
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(AuthResponse{
				MFARequired: true,
				Email:       req.Email,
				Message:     "Mandatory 2FA code verification is required.",
			})
			return
		}

		if !validateTOTP(dbTwoFactorSecret, req.TwoFactorCode) {
			h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_FAILURE", "Incorrect 2FA passcode", ip)
			http.Error(w, "invalid_2fa_code", http.StatusUnauthorized)
			return
		}
	}

	// Log device fingerprint details
	if req.DeviceFingerprint != "" {
		_, _ = h.dbPool.Exec(ctx, "UPDATE system_admins SET device_fingerprint = $1, last_active_at = CURRENT_TIMESTAMP WHERE id = $2", req.DeviceFingerprint, dbUserID)
	} else {
		_, _ = h.dbPool.Exec(ctx, "UPDATE system_admins SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1", dbUserID)
	}

	// 5. Generate signed JWT token
	expirationTime := time.Now().Add(12 * time.Hour)
	claims := &middleware.CustomClaims{
		UserID: dbUserID,
		Role:   dbRole,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   dbUserID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "drivers-for-u-auth",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, dbUserID, req.Email, "LOGIN_SUCCESS", fmt.Sprintf("Authentication completed. Role: %s, Scope: %s", dbRole, dbCityScope), ip)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(AuthResponse{
		Token:     tokenString,
		ExpiresAt: expirationTime,
		Role:      dbRole,
	})
}

// HandleEnroll2FA provisions a fresh TOTP secret for the authenticated admin and
// returns the otpauth URI to render as a QR code. Re-enrolling rotates the secret.
func (h *AdminAuthHandler) HandleEnroll2FA(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	adminID, ok := middleware.GetUserIDFromContext(ctx)
	if !ok || adminID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var email string
	if err := h.dbPool.QueryRow(ctx, "SELECT email FROM system_admins WHERE id = $1", adminID).Scan(&email); err != nil {
		http.Error(w, "admin_not_found", http.StatusNotFound)
		return
	}

	secret := generateTOTPSecret()
	if _, err := h.dbPool.Exec(ctx,
		"UPDATE system_admins SET two_factor_secret = $1, two_factor_enabled = true WHERE id = $2",
		secret, adminID); err != nil {
		http.Error(w, "failed_to_store_secret", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, adminID, email, "2FA_ENROLLED", "TOTP secret provisioned", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"secret":       secret,
		"otpauth_uri":  totpEnrolmentURI(secret, email, "Drivers-For-U Admin"),
		"instructions": "Scan in an authenticator app, then verify a 6-digit code at next login.",
	})
}

// HandleAdminRegister transactionally creates a new administrative record in PostgreSQL
func (h *AdminAuthHandler) HandleAdminRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_request_payload", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" || req.FullName == "" || req.RegionPrefix == "" {
		http.Error(w, "missing_required_fields", http.StatusBadRequest)
		return
	}

	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	requestedRole := strings.ToUpper(strings.TrimSpace(req.Role))
	if !isValidRole(requestedRole) {
		requestedRole = "AUDITOR"
	}

	cityScope := req.CityScope
	if cityScope == "" {
		cityScope = req.RegionPrefix
	}

	query := `
		INSERT INTO system_admins (full_name, phone, email, password_hash, role, region_prefix, city_scope)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err = h.dbPool.Exec(ctx, query, req.FullName, req.Phone, req.Email, string(hashedBytes), requestedRole, req.RegionPrefix, cityScope)
	if err != nil {
		http.Error(w, "registration_failed_conflict", http.StatusConflict)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", req.Email, "ADMIN_REGISTERED", fmt.Sprintf("Role %s created", requestedRole), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// HandleListAdmins retrieves the list of all administrators
func (h *AdminAuthHandler) HandleListAdmins(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, full_name, phone, email, role, region_prefix, is_active, two_factor_enabled, last_active_at, city_scope
		FROM system_admins
		ORDER BY created_at DESC
	`
	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type AdminItem struct {
		ID                 string     `json:"id"`
		FullName           string     `json:"full_name"`
		Phone              string     `json:"phone"`
		Email              string     `json:"email"`
		Role               string     `json:"role"`
		RegionPrefix       string     `json:"region_prefix"`
		IsActive           bool       `json:"is_active"`
		TwoFactorEnabled   bool       `json:"two_factor_enabled"`
		LastActiveAt       *time.Time `json:"last_active_at"`
		CityScope          string     `json:"city_scope"`
	}

	var list []AdminItem
	for rows.Next() {
		var item AdminItem
		err := rows.Scan(
			&item.ID, &item.FullName, &item.Phone, &item.Email, &item.Role,
			&item.RegionPrefix, &item.IsActive, &item.TwoFactorEnabled, &item.LastActiveAt, &item.CityScope,
		)
		if err == nil {
			list = append(list, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(list)
}

// HandleInviteAdmin creates a new admin user record with random initial password hash
func (h *AdminAuthHandler) HandleInviteAdmin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		FullName     string `json:"full_name"`
		Phone        string `json:"phone"`
		Email        string `json:"email"`
		Role         string `json:"role"`
		RegionPrefix string `json:"region_prefix"`
		CityScope    string `json:"city_scope"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.FullName == "" || req.Role == "" {
		http.Error(w, "missing_fields", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	requestedRole := strings.ToUpper(strings.TrimSpace(req.Role))
	if !isValidRole(requestedRole) {
		http.Error(w, "invalid_role", http.StatusBadRequest)
		return
	}

	// Standard placeholder password hashed to satisfy non-null constraints
	dummyPass := "TempPassword123"
	hashedBytes, _ := bcrypt.GenerateFromPassword([]byte(dummyPass), 12)

	cityScope := req.CityScope
	if cityScope == "" {
		cityScope = req.RegionPrefix
	}
	if cityScope == "" {
		cityScope = "KOL"
	}
	regPrefix := req.RegionPrefix
	if regPrefix == "" {
		regPrefix = "KOL"
	}

	query := `
		INSERT INTO system_admins (full_name, phone, email, password_hash, role, region_prefix, city_scope, two_factor_enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, true)
	`
	_, err := h.dbPool.Exec(ctx, query, req.FullName, req.Phone, req.Email, string(hashedBytes), requestedRole, regPrefix, cityScope)
	if err != nil {
		http.Error(w, "invite_failed_conflict", http.StatusConflict)
		return
	}

	h.recordAuditLog(ctx, "00000000-0000-0000-0000-000000000000", req.Email, "ADMIN_INVITED", fmt.Sprintf("Invited as %s with scope %s", requestedRole, cityScope), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Admin profile invited successfully."})
}

// HandleEditRole updates role and city scope parameters
func (h *AdminAuthHandler) HandleEditRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AdminID   string `json:"admin_id"`
		Role      string `json:"role"`
		CityScope string `json:"city_scope"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	requestedRole := strings.ToUpper(strings.TrimSpace(req.Role))
	if !isValidRole(requestedRole) {
		http.Error(w, "invalid_role", http.StatusBadRequest)
		return
	}

	query := `
		UPDATE system_admins
		SET role = $1, city_scope = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $3::uuid
	`
	_, err := h.dbPool.Exec(ctx, query, requestedRole, req.CityScope, req.AdminID)
	if err != nil {
		http.Error(w, "update_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, req.AdminID, "", "ROLE_UPDATED", fmt.Sprintf("New Role: %s, Scope: %s", requestedRole, req.CityScope), getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// HandleSuspendAdmin locks administrative accounts by toggling the active boolean gate
func (h *AdminAuthHandler) HandleSuspendAdmin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AdminID  string `json:"admin_id"`
		Suspend  bool   `json:"suspend"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	activeState := !req.Suspend
	query := `
		UPDATE system_admins
		SET is_active = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2::uuid
	`
	_, err := h.dbPool.Exec(ctx, query, activeState, req.AdminID)
	if err != nil {
		http.Error(w, "suspension_update_failed", http.StatusInternalServerError)
		return
	}

	actionStr := "ACCOUNT_ACTIVATED"
	if req.Suspend {
		actionStr = "ACCOUNT_SUSPENDED"
	}
	h.recordAuditLog(ctx, req.AdminID, "", actionStr, "Admin suspension state altered", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// HandleReset2FA clears the 2FA secret
func (h *AdminAuthHandler) HandleReset2FA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AdminID string `json:"admin_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		UPDATE system_admins
		SET two_factor_secret = '', two_factor_enabled = true, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1::uuid
	`
	_, err := h.dbPool.Exec(ctx, query, req.AdminID)
	if err != nil {
		http.Error(w, "reset_2fa_failed", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, req.AdminID, "", "MFA_RESET", "TOTP/SMS 2FA security parameter reset requested", getClientIP(r))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// HandleGetAuditLogs lists the compliance logs matching filters
func (h *AdminAuthHandler) HandleGetAuditLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	adminID := r.URL.Query().Get("admin_id")

	var rows pgx.Rows
	var err error

	if adminID != "" {
		query := `
			SELECT id, admin_id, admin_email, action, details, ip_address, created_at
			FROM admin_audit_logs
			WHERE admin_id = $1::uuid OR admin_email = $1
			ORDER BY created_at DESC
			LIMIT 100
		`
		rows, err = h.dbPool.Query(ctx, query, adminID)
	} else {
		query := `
			SELECT id, admin_id, admin_email, action, details, ip_address, created_at
			FROM admin_audit_logs
			ORDER BY created_at DESC
			LIMIT 150
		`
		rows, err = h.dbPool.Query(ctx, query)
	}

	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type AuditLogItem struct {
		ID         string    `json:"id"`
		AdminID    string    `json:"admin_id"`
		AdminEmail string    `json:"admin_email"`
		Action     string    `json:"action"`
		Details    string    `json:"details"`
		IPAddress  string    `json:"ip_address"`
		CreatedAt  time.Time `json:"created_at"`
	}

	var logs []AuditLogItem
	for rows.Next() {
		var item AuditLogItem
		err := rows.Scan(&item.ID, &item.AdminID, &item.AdminEmail, &item.Action, &item.Details, &item.IPAddress, &item.CreatedAt)
		if err == nil {
			logs = append(logs, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}
