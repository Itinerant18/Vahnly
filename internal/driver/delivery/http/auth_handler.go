package http

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/platform/driver-delivery/internal/firebaseauth"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"golang.org/x/crypto/bcrypt"
)

type DriverLoginRequest struct {
	Phone             string `json:"phone"`
	Password          string `json:"password"`
	DeviceID          string `json:"device_id"`
	AppVersion        string `json:"app_version"`
	GeoLocation       string `json:"geo_location"`
}

type DriverRegisterRequest struct {
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	CityPrefix   string `json:"city_prefix"`
	PhoneToken   string `json:"phone_token,omitempty"`
}

type DriverAuthResponse struct {
	Token              string    `json:"token"`
	ExpiresAt          time.Time `json:"expires_at"`
	Role               string    `json:"role"`
	DriverID           string    `json:"driver_id"`
	VerificationStatus string    `json:"verification_status"`
	OnboardingStep     int       `json:"onboarding_step"`
	Name               string    `json:"name"`
	PhoneVerified      bool      `json:"phone_verified"`
	Phone              string    `json:"phone"`
}

type DriverAuthHandler struct {
	dbPool    *pgxpool.Pool
	redis     *redis.ClusterClient
	jwtSecret []byte
}

func NewDriverAuthHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient, jwtSecret string) *DriverAuthHandler {
	return &DriverAuthHandler{
		dbPool:    dbPool,
		redis:     redisClient,
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

// verifyDriverPhoneToken validates a phone-ownership proof and returns the verified
// E.164 number. It accepts a Firebase Phone Auth ID token (primary — the number is
// read from the signed token, never a client field) and falls back to the gateway's
// own short-lived registration_phone JWT issued by the legacy log-OTP path, so local
// dev works without a Firebase project configured.
func (h *DriverAuthHandler) verifyDriverPhoneToken(ctx context.Context, idToken string) (string, error) {
	if idToken == "" {
		return "", fmt.Errorf("empty phone token")
	}
	// Primary: Firebase Phone Auth ID token.
	if fc, err := firebaseauth.VerifyIDToken(ctx, idToken, firebaseauth.ProjectID()); err == nil && fc.PhoneNumber != "" {
		return fc.PhoneNumber, nil
	}
	// Fallback: the gateway's own registration_phone JWT (dev / log-OTP path).
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(idToken, claims, func(t *jwt.Token) (interface{}, error) {
		return h.jwtSecret, nil
	})
	if err == nil && token.Valid && claims["purpose"] == "registration_phone" {
		if sub, ok := claims["sub"].(string); ok && sub != "" {
			return sub, nil
		}
	}
	return "", fmt.Errorf("invalid phone verification token")
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

	if req.PhoneToken == "" {
		http.Error(w, "Phone verification is required to complete registration", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Verify the phone-ownership proof (Firebase Phone Auth token, or dev fallback JWT).
	verifiedPhone, err := h.verifyDriverPhoneToken(ctx, req.PhoneToken)
	if err != nil || verifiedPhone == "" {
		http.Error(w, "Invalid or expired phone verification token", http.StatusUnauthorized)
		return
	}

	if normalizePhone(req.Phone) != normalizePhone(verifiedPhone) {
		http.Error(w, "Phone number mismatch between verification and registration", http.StatusBadRequest)
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	var newDriverID string
	query := `
		INSERT INTO drivers (name, phone, email, password_hash, city_prefix, current_state, is_verified, onboarding_step, verification_status, phone_verified)
		VALUES ($1, $2, $3, $4, $5, 'OFFLINE', false, 1, 'ONBOARDING', true)
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
	var dbPhone string
	var dbPasswordHash string
	var dbCityPrefix string
	var dbVerificationStatus string
	var dbOnboardingStep int
	var dbPhoneVerified bool

	query := `
		SELECT id, name, phone, password_hash, city_prefix, verification_status, onboarding_step, phone_verified
		FROM drivers
		WHERE phone = $1
	`
	err := h.dbPool.QueryRow(ctx, query, req.Phone).Scan(
		&dbDriverID, &dbName, &dbPhone, &dbPasswordHash, &dbCityPrefix, &dbVerificationStatus, &dbOnboardingStep, &dbPhoneVerified,
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
	jti := uuid.NewString()
	claims := &middleware.CustomClaims{
		UserID:        dbDriverID,
		Role:          "DRIVER",
		CityScope:     dbCityPrefix,
		PhoneVerified: dbPhoneVerified,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   dbDriverID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vahnly-driver-auth",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "JWT token generation failed", http.StatusInternalServerError)
		return
	}

	// Record the session jti so the gateway's DRIVER session validator accepts this token.
	// Without it, the validator returns session_revoked_or_expired on every authed request.
	if h.redis != nil {
		if sErr := h.redis.Set(ctx, middleware.DriverSessionKey(dbDriverID), jti, 7*24*time.Hour).Err(); sErr != nil {
			log.Printf("[AUTH_WARN] failed to record driver session for %s: %v", dbDriverID, sErr)
		}
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
		PhoneVerified:      dbPhoneVerified,
		Phone:              dbPhone,
	})
}

type DriverGoogleLoginRequest struct {
	IDToken     string `json:"id_token"`
	DeviceID    string `json:"device_id"`
	AppVersion  string `json:"app_version"`
	GeoLocation string `json:"geo_location"`
	Phone       string `json:"phone,omitempty"`
	CityPrefix  string `json:"city_prefix,omitempty"`
	Name        string `json:"name,omitempty"`
	PhoneToken  string `json:"phone_token,omitempty"`
}

func (h *DriverAuthHandler) HandleDriverGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DriverGoogleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	if req.IDToken == "" {
		http.Error(w, "Missing ID token", http.StatusBadRequest)
		return
	}

	// Verify ID token via Google TokenInfo API
	tokenInfoUrl := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(req.IDToken)
	resp, err := http.Get(tokenInfoUrl)
	if err != nil {
		http.Error(w, "Failed to verify ID token with Google", http.StatusUnauthorized)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "Invalid Google ID token", http.StatusUnauthorized)
		return
	}

	var googleClaims struct {
		Email         string      `json:"email"`
		EmailVerified interface{} `json:"email_verified"`
		Name          string      `json:"name"`
		Sub           string      `json:"sub"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&googleClaims); err != nil {
		http.Error(w, "Failed to decode Google token response", http.StatusInternalServerError)
		return
	}

	if googleClaims.Email == "" {
		http.Error(w, "Google account does not provide email", http.StatusBadRequest)
		return
	}

	// Parse email_verified robustly since it can be string or bool from Google TokenInfo
	emailVerified := false
	if googleClaims.EmailVerified != nil {
		switch v := googleClaims.EmailVerified.(type) {
		case bool:
			emailVerified = v
		case string:
			emailVerified = (v == "true")
		}
	}

	if !emailVerified {
		http.Error(w, "Google email not verified", http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var dbDriverID string
	var dbName string
	var dbPhone string
	var dbCityPrefix string
	var dbVerificationStatus string
	var dbOnboardingStep int
	var dbPhoneVerified bool

	query := `
		SELECT id, name, phone, city_prefix, verification_status, onboarding_step, phone_verified
		FROM drivers
		WHERE email = $1
	`
	err = h.dbPool.QueryRow(ctx, query, googleClaims.Email).Scan(
		&dbDriverID, &dbName, &dbPhone, &dbCityPrefix, &dbVerificationStatus, &dbOnboardingStep, &dbPhoneVerified,
	)

	ip := getClientIP(r)
	deviceID := req.DeviceID
	appVersion := req.AppVersion
	geoLocation := req.GeoLocation

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// User is not registered as a driver yet
			// Check if we have registration info to create the account now
			if req.Phone == "" || req.CityPrefix == "" {
				// Return status indicating registration is required
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"registered": false,
					"email":      googleClaims.Email,
					"name":       googleClaims.Name,
				})
				return
			}

			if req.PhoneToken == "" {
				http.Error(w, "Phone verification is required to complete Google registration", http.StatusBadRequest)
				return
			}

			// Verify the phone-ownership proof (Firebase Phone Auth token, or dev fallback JWT).
			verifiedPhone, vErr := h.verifyDriverPhoneToken(ctx, req.PhoneToken)
			if vErr != nil || verifiedPhone == "" {
				http.Error(w, "Invalid or expired phone verification token", http.StatusUnauthorized)
				return
			}

			if normalizePhone(req.Phone) != normalizePhone(verifiedPhone) {
				http.Error(w, "Phone number mismatch between verification and registration", http.StatusBadRequest)
				return
			}

			// Perform registration
			// Generate dummy password hash for Google login user
			dummyPwd := "oauth-google-" + googleClaims.Sub
			hashedPassword, err := bcrypt.GenerateFromPassword([]byte(dummyPwd), bcrypt.DefaultCost)
			if err != nil {
				http.Error(w, "Server error", http.StatusInternalServerError)
				return
			}

			regName := req.Name
			if regName == "" {
				regName = googleClaims.Name
			}
			if regName == "" {
				regName = "Google Driver"
			}

			insertQuery := `
				INSERT INTO drivers (name, phone, email, password_hash, city_prefix, current_state, is_verified, onboarding_step, verification_status, phone_verified)
				VALUES ($1, $2, $3, $4, $5, 'OFFLINE', false, 1, 'ONBOARDING', true)
				RETURNING id, name, phone, city_prefix, verification_status, onboarding_step, phone_verified
			`
			err = h.dbPool.QueryRow(ctx, insertQuery, regName, verifiedPhone, googleClaims.Email, string(hashedPassword), req.CityPrefix).Scan(
				&dbDriverID, &dbName, &dbPhone, &dbCityPrefix, &dbVerificationStatus, &dbOnboardingStep, &dbPhoneVerified,
			)
			if err != nil {
				http.Error(w, "Driver Google registration failed, phone might be already registered", http.StatusConflict)
				return
			}

			h.recordAuditLog(ctx, dbDriverID, "REGISTER_SUCCESS_GOOGLE", deviceID, ip, appVersion, geoLocation)
		} else {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
	}

	// Update last login timestamp
	_, _ = h.dbPool.Exec(ctx, "UPDATE drivers SET last_login_at = NOW() WHERE id = $1", dbDriverID)

	// Record audit trail
	h.recordAuditLog(ctx, dbDriverID, "LOGIN_SUCCESS_GOOGLE", deviceID, ip, appVersion, geoLocation)

	// Generate signed JWT token
	expirationTime := time.Now().Add(7 * 24 * time.Hour) // 7 days token for mobile driver app
	jti := uuid.NewString()
	claims := &middleware.CustomClaims{
		UserID:        dbDriverID,
		Role:          "DRIVER",
		CityScope:     dbCityPrefix,
		PhoneVerified: dbPhoneVerified,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   dbDriverID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vahnly-driver-auth",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "JWT token generation failed", http.StatusInternalServerError)
		return
	}

	// Record the session jti so the gateway's DRIVER session validator accepts this token.
	// Without it, the validator returns session_revoked_or_expired on every authed request.
	if h.redis != nil {
		if sErr := h.redis.Set(ctx, middleware.DriverSessionKey(dbDriverID), jti, 7*24*time.Hour).Err(); sErr != nil {
			log.Printf("[AUTH_WARN] failed to record driver session for %s: %v", dbDriverID, sErr)
		}
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
		PhoneVerified:      dbPhoneVerified,
		Phone:              dbPhone,
	})
}

// India phone regex
var indiaPhoneRe = regexp.MustCompile(`^\+91[6-9]\d{9}$`)

// normalizePhone trims spaces and prefixes a bare 10-digit Indian number with +91.
func normalizePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if matched, _ := regexp.MatchString(`^[6-9]\d{9}$`, phone); matched {
		return "+91" + phone
	}
	phone = strings.ReplaceAll(phone, " ", "")
	phone = strings.ReplaceAll(phone, "-", "")
	return phone
}

// generateOTP returns a cryptographically-random 6-digit numeric OTP.
func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// HandleSendOTP generates and dispatches a login/verification OTP
func (h *DriverAuthHandler) HandleSendOTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	phone := normalizePhone(req.Phone)
	if !indiaPhoneRe.MatchString(phone) {
		http.Error(w, "Invalid phone number: must be a 10-digit Indian mobile number", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Rate limiting: max 5 requests per phone per hour
	if h.redis != nil {
		key := "driver:otp:rate:" + phone
		n, err := h.redis.Incr(ctx, key).Result()
		if err == nil {
			if n == 1 {
				_ = h.redis.Expire(ctx, key, time.Hour).Err()
			}
			if n > 5 {
				http.Error(w, "OTP request rate limit exceeded. Try again in an hour.", http.StatusTooManyRequests)
				return
			}
		}
	}

	otp, err := generateOTP()
	if err != nil {
		http.Error(w, "Failed to generate OTP", http.StatusInternalServerError)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(otp), 10)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(5 * time.Minute)
	_, err = h.dbPool.Exec(ctx, `
		INSERT INTO driver_otp_sessions (phone, otp_hash, purpose, expires_at)
		VALUES ($1, $2, 'LOGIN', $3)`, phone, string(hash), expiresAt)
	if err != nil {
		http.Error(w, "Failed to store OTP session", http.StatusInternalServerError)
		return
	}

	log.Printf("[DRIVER_SMS] OTP for %s is %s", phone, otp)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message":            "OTP sent successfully",
		"expires_in_seconds": 300,
	})
}

// HandleVerifyOTP verifies driver OTP and returns session JWT (if registered) or phone_token (if unregistered)
func (h *DriverAuthHandler) HandleVerifyOTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone string `json:"phone"`
		OTP   string `json:"otp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	phone := normalizePhone(req.Phone)
	if !indiaPhoneRe.MatchString(phone) {
		http.Error(w, "Invalid phone number", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	isFirebaseToken := strings.HasPrefix(req.OTP, "eyJ")
	if isFirebaseToken {
		verifiedPhone, vErr := h.verifyDriverPhoneToken(ctx, req.OTP)
		if vErr != nil || verifiedPhone == "" {
			http.Error(w, "Invalid Firebase verification token", http.StatusUnauthorized)
			return
		}
		if normalizePhone(verifiedPhone) != phone {
			http.Error(w, "Verification phone number mismatch", http.StatusBadRequest)
			return
		}
	} else {
		var sessionID string
		var otpHash string
		var attempts int
		var maxAttempts int

		querySession := `
			SELECT id, otp_hash, attempts, max_attempts
			FROM driver_otp_sessions
			WHERE phone = $1 AND purpose = 'LOGIN' AND used_at IS NULL AND expires_at > now()
			ORDER BY created_at DESC
			LIMIT 1
		`
		err := h.dbPool.QueryRow(ctx, querySession, phone).Scan(&sessionID, &otpHash, &attempts, &maxAttempts)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.Error(w, "No active OTP session found or OTP expired", http.StatusUnauthorized)
				return
			}
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		if attempts >= maxAttempts {
			http.Error(w, "Too many verification attempts; request a new OTP", http.StatusUnauthorized)
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(otpHash), []byte(req.OTP)); err != nil {
			_, _ = h.dbPool.Exec(ctx, "UPDATE driver_otp_sessions SET attempts = attempts + 1 WHERE id = $1::uuid", sessionID)
			http.Error(w, "Incorrect OTP", http.StatusUnauthorized)
			return
		}

		_, _ = h.dbPool.Exec(ctx, "UPDATE driver_otp_sessions SET used_at = now() WHERE id = $1::uuid", sessionID)
	}

	// Check if driver exists
	var dbDriverID string
	var dbName string
	var dbCityPrefix string
	var dbVerificationStatus string
	var dbOnboardingStep int

	queryDriver := `
		SELECT id, name, city_prefix, verification_status, onboarding_step
		FROM drivers
		WHERE phone = $1
	`
	err := h.dbPool.QueryRow(ctx, queryDriver, phone).Scan(&dbDriverID, &dbName, &dbCityPrefix, &dbVerificationStatus, &dbOnboardingStep)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Driver does not exist yet. Issue a short-lived signed registration phone_token
			phoneTokenClaims := jwt.MapClaims{
				"sub":     phone,
				"exp":     time.Now().Add(15 * time.Minute).Unix(),
				"purpose": "registration_phone",
			}
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, phoneTokenClaims)
			phoneTokenString, tErr := token.SignedString(h.jwtSecret)
			if tErr != nil {
				http.Error(w, "Failed to generate token", http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"is_new_driver": true,
				"phone_token":   phoneTokenString,
				"phone":         phone,
			})
			return
		}
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Driver exists, verify their phone and log them in
	_, _ = h.dbPool.Exec(ctx, "UPDATE drivers SET phone_verified = true, last_login_at = now() WHERE id = $1::uuid", dbDriverID)

	// Issue JWT
	expirationTime := time.Now().Add(7 * 24 * time.Hour)
	jti := uuid.NewString()
	claims := &middleware.CustomClaims{
		UserID:        dbDriverID,
		Role:          "DRIVER",
		CityScope:     dbCityPrefix,
		PhoneVerified: true,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   dbDriverID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vahnly-driver-auth",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	if h.redis != nil {
		_ = h.redis.Set(ctx, middleware.DriverSessionKey(dbDriverID), jti, 7*24*time.Hour).Err()
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
		PhoneVerified:      true,
		Phone:              phone,
	})
}
