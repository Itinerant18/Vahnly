package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"golang.org/x/crypto/bcrypt"
)

type AuthRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	Role      string    `json:"role"`
}

type RegisterRequest struct {
	FullName     string `json:"full_name"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	RegionPrefix string `json:"region_prefix"`
	Role         string `json:"role"`
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

// HandleAdminLogin verifies database credentials and issues signed short-lived JWT tokens
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

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var dbUserID string
	var dbPasswordHash string
	var dbRole string

	// Query database pool ensuring user role matches elevated system permission bounds
	query := `
		SELECT id, password_hash, role 
		FROM system_admins 
		WHERE email = $1 AND is_active = true
	`
	err := h.dbPool.QueryRow(ctx, query, req.Email).Scan(&dbUserID, &dbPasswordHash, &dbRole)
	if err != nil {
		// Defensive Strategy: Return generic 401 Unauthorized error to eliminate user-enumeration profiling
		http.Error(w, "invalid_credentials", http.StatusUnauthorized)
		return
	}

	// Verify password hash integrity via cryptographically constant-time comparison
	if err := bcrypt.CompareHashAndPassword([]byte(dbPasswordHash), []byte(req.Password)); err != nil {
		http.Error(w, "invalid_credentials", http.StatusUnauthorized)
		return
	}

	// Establish short-lived token expiration boundary (e.g., 12 Hours) to limit token hijack exposure
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{
		Token:     tokenString,
		ExpiresAt: expirationTime,
		Role:      dbRole,
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

	// Encrypt the password using bcrypt with a work factor of 12
	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Validate the requested role or default it to FLEET_MANAGER
	requestedRole := strings.ToUpper(strings.TrimSpace(req.Role))
	if requestedRole != "SUPER_ADMIN" && requestedRole != "FLEET_MANAGER" && requestedRole != "FINANCIAL_AUDITOR" {
		requestedRole = "FLEET_MANAGER"
	}

	query := `
		INSERT INTO system_admins (full_name, phone, email, password_hash, role, region_prefix)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err = h.dbPool.Exec(ctx, query, req.FullName, req.Phone, req.Email, string(hashedBytes), requestedRole, req.RegionPrefix)
	if err != nil {
		// Return a conflict response if email already exists or registration fails
		http.Error(w, "registration_failed", http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}
