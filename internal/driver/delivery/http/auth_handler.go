package http

import (
	"context"
	"encoding/json"
	"errors"
	"log"
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

type DriverLoginRequest struct {
	Phone       string `json:"phone"`
	Password    string `json:"password"`
	DeviceID    string `json:"device_id"`
	AppVersion  string `json:"app_version"`
	GeoLocation string `json:"geo_location"`
}

type DriverRegisterRequest struct {
	Name       string `json:"name"`
	Phone      string `json:"phone"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	CityPrefix string `json:"city_prefix"`
}

type DriverAuthResponse struct {
	Token              string    `json:"token"`
	ExpiresAt          time.Time `json:"expires_at"`
	Role               string    `json:"role"`
	DriverID           string    `json:"driver_id"`
	VerificationStatus string    `json:"verification_status"`
	OnboardingStep     int       `json:"onboarding_step"`
	Name               string    `json:"name"`
}

type DriverAuthHandler struct {
	dbPool    *pgxpool.Pool
	jwtSecret []byte
}

func NewDriverAuthHandler(dbPool *pgxpool.Pool, jwtSecret string) *DriverAuthHandler {
	return &DriverAuthHandler{
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

// loginFailureThreshold is the number of failed attempts from a single IP
// within the last 15 minutes that triggers login throttling.
const loginFailureThreshold = 10

// recentLoginFailures counts failed login events recorded for an IP in the last
// 15 minutes. It fails open (returns 0) on query error so a metering failure
// never locks legitimate drivers out.
func (h *DriverAuthHandler) recentLoginFailures(ctx context.Context, ip string) int {
	if ip == "" {
		return 0
	}
	const query = `
		SELECT COUNT(*) FROM audit_logs
		WHERE ip_address = $1
		  AND action LIKE 'LOGIN_FAILURE%'
		  AND created_at > NOW() - INTERVAL '15 minutes'
	`
	var count int
	if err := h.dbPool.QueryRow(ctx, query, ip).Scan(&count); err != nil {
		return 0
	}
	return count
}

func (h *DriverAuthHandler) recordAuditLog(ctx context.Context, driverID string, action string, deviceID string, ip string, appVersion string, geoLocation string) {
	query := `
		INSERT INTO audit_logs (driver_id, action, device_id, ip_address, app_version, geo_location)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	var driverUUID interface{} = nil
	if driverID != "" {
		driverUUID = driverID
	}
	if _, err := h.dbPool.Exec(ctx, query, driverUUID, action, deviceID, ip, appVersion, geoLocation); err != nil {
		// Audit logging is best-effort and must not block auth, but a silent
		// failure leaves a hole in the security trail — surface it.
		log.Printf("[AUDIT] failed to record driver auth event action=%s driver=%q: %v", action, driverID, err)
	}
}

// HandleDriverRegister creates a new driver record with default ONBOARDING status
func (h *DriverAuthHandler) HandleDriverRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DriverRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	if req.Phone == "" || req.Password == "" || req.Name == "" || req.CityPrefix == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	var newDriverID string
	query := `
		INSERT INTO drivers (name, phone, email, password_hash, city_prefix, current_state, is_verified, onboarding_step, verification_status)
		VALUES ($1, $2, $3, $4, $5, 'OFFLINE', false, 1, 'ONBOARDING')
		RETURNING id
	`

	var emailVal *string = nil
	if req.Email != "" {
		emailVal = &req.Email
	}

	err = h.dbPool.QueryRow(ctx, query, req.Name, req.Phone, emailVal, string(hashedPassword), req.CityPrefix).Scan(&newDriverID)
	if err != nil {
		// Log or check for duplicate phone
		http.Error(w, "Driver registration failed, phone or email might be already registered", http.StatusConflict)
		return
	}

	// Record audit trail
	ip := getClientIP(r)
	h.recordAuditLog(ctx, newDriverID, "REGISTER_SUCCESS", r.Header.Get("X-Device-Id"), ip, r.Header.Get("X-App-Version"), r.Header.Get("X-Geo-Location"))

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message":   "Driver registered successfully",
		"driver_id": newDriverID,
	})
}

// HandleDriverLogin verifies phone & password, logs captured telemetry and issues JWT token
func (h *DriverAuthHandler) HandleDriverLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DriverLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Telemetry metrics
	ip := getClientIP(r)
	deviceID := req.DeviceID
	if deviceID == "" {
		deviceID = r.Header.Get("X-Device-Id")
	}
	appVersion := req.AppVersion
	if appVersion == "" {
		appVersion = r.Header.Get("X-App-Version")
	}
	geoLocation := req.GeoLocation
	if geoLocation == "" {
		geoLocation = r.Header.Get("X-Geo-Location")
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Throttle brute-force: too many recent failed attempts from this IP get a
	// 429 before any credential check is performed.
	if h.recentLoginFailures(ctx, ip) >= loginFailureThreshold {
		h.recordAuditLog(ctx, "", "LOGIN_THROTTLED", deviceID, ip, appVersion, geoLocation)
		w.Header().Set("Retry-After", "900")
		http.Error(w, "Too many failed login attempts; try again later", http.StatusTooManyRequests)
		return
	}

	var dbDriverID string
	var dbName string
	var dbPasswordHash string
	var dbCityPrefix string
	var dbVerificationStatus string
	var dbOnboardingStep int

	query := `
		SELECT id, name, password_hash, city_prefix, verification_status, onboarding_step
		FROM drivers
		WHERE phone = $1
	`
	err := h.dbPool.QueryRow(ctx, query, req.Phone).Scan(
		&dbDriverID, &dbName, &dbPasswordHash, &dbCityPrefix, &dbVerificationStatus, &dbOnboardingStep,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			h.recordAuditLog(ctx, "", "LOGIN_FAILURE_NOT_FOUND", deviceID, ip, appVersion, geoLocation)
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	// Verify Bcrypt hash
	err = bcrypt.CompareHashAndPassword([]byte(dbPasswordHash), []byte(req.Password))
	if err != nil {
		h.recordAuditLog(ctx, dbDriverID, "LOGIN_FAILURE_PASSWORD", deviceID, ip, appVersion, geoLocation)
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Update last login timestamp
	_, _ = h.dbPool.Exec(ctx, "UPDATE drivers SET last_login_at = NOW() WHERE id = $1", dbDriverID)

	// Record audit trail
	h.recordAuditLog(ctx, dbDriverID, "LOGIN_SUCCESS", deviceID, ip, appVersion, geoLocation)

	// Generate signed JWT token
	expirationTime := time.Now().Add(7 * 24 * time.Hour) // 7 days token for mobile driver app
	claims := &middleware.CustomClaims{
		UserID:    dbDriverID,
		Role:      "DRIVER",
		CityScope: dbCityPrefix,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   dbDriverID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "drivers-for-u-driver-auth",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "JWT token generation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(DriverAuthResponse{
		Token:              tokenString,
		ExpiresAt:          expirationTime,
		Role:               "DRIVER",
		DriverID:           dbDriverID,
		VerificationStatus: dbVerificationStatus,
		OnboardingStep:     dbOnboardingStep,
		Name:               dbName,
	})
}
