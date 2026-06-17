package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/platform/driver-delivery/internal/firebaseauth"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
	riderSvc "github.com/platform/driver-delivery/internal/rider/service"
)

type verifyRequest struct {
	FirebaseIDToken string `json:"firebase_id_token"`
	UserType        string `json:"user_type"` // "driver" | "rider"
	Name            string `json:"name,omitempty"`
	CityPrefix      string `json:"city_prefix,omitempty"`
}

type verifyResponse struct {
	Success   bool        `json:"success"`
	IsNewUser bool        `json:"is_new_user"`
	Data      interface{} `json:"data,omitempty"`
	Code      string      `json:"code,omitempty"`
	Message   string      `json:"message,omitempty"`
}

// FirebaseAuthHandler handles POST /api/v1/auth/firebase/verify.
// Accepts a Firebase ID token from any auth provider (phone, Google, email),
// requires a verified phone_number claim, and returns a platform JWT.
type FirebaseAuthHandler struct {
	db        *pgxpool.Pool
	riderAuth *riderSvc.AuthService
	jwtSecret []byte
	redis     *redis.ClusterClient
}

func NewFirebaseAuthHandler(
	db *pgxpool.Pool,
	riderAuth *riderSvc.AuthService,
	redisClient *redis.ClusterClient,
	jwtSecret string,
) *FirebaseAuthHandler {
	return &FirebaseAuthHandler{
		db:        db,
		riderAuth: riderAuth,
		jwtSecret: []byte(jwtSecret),
		redis:     redisClient,
	}
}

func (h *FirebaseAuthHandler) HandleFirebaseVerify(w http.ResponseWriter, r *http.Request) {
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, verifyResponse{Success: false, Code: "BAD_REQUEST", Message: "invalid JSON"})
		return
	}

	if req.FirebaseIDToken == "" {
		writeJSON(w, 400, verifyResponse{Success: false, Code: "BAD_REQUEST", Message: "firebase_id_token required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	fc, err := firebaseauth.VerifyIDToken(ctx, req.FirebaseIDToken, firebaseauth.ProjectID())
	if err != nil {
		writeJSON(w, 401, verifyResponse{Success: false, Code: "INVALID_TOKEN", Message: "invalid firebase token"})
		return
	}

	// Phone number is mandatory — the platform uses phone as the canonical identity.
	if fc.PhoneNumber == "" {
		writeJSON(w, 403, verifyResponse{Success: false, Code: "PHONE_REQUIRED", Message: "phone verification required"})
		return
	}

	var platformJWT string
	var isNew bool

	switch strings.ToLower(strings.TrimSpace(req.UserType)) {
	case "rider":
		platformJWT, isNew, err = h.riderFindOrCreate(ctx, fc.PhoneNumber)
		if err != nil {
			log.Printf("[FIREBASE_AUTH] rider error phone=%s: %v", fc.PhoneNumber, err)
			writeJSON(w, 500, verifyResponse{Success: false, Message: "server error"})
			return
		}

	case "driver":
		platformJWT, isNew, err = h.driverFindOrCreate(ctx, fc.PhoneNumber, fc.Email, fc.Name, req.Name, req.CityPrefix)
		if err != nil {
			log.Printf("[FIREBASE_AUTH] driver error phone=%s: %v", fc.PhoneNumber, err)
			writeJSON(w, 500, verifyResponse{Success: false, Message: "server error"})
			return
		}

	default:
		writeJSON(w, 400, verifyResponse{Success: false, Code: "INVALID_USER_TYPE", Message: "user_type must be driver or rider"})
		return
	}

	writeJSON(w, 200, verifyResponse{
		Success:   true,
		IsNewUser: isNew,
		Data:      map[string]string{"token": platformJWT},
	})
}

// riderFindOrCreate delegates to the rider auth service's phone-verified login path.
func (h *FirebaseAuthHandler) riderFindOrCreate(ctx context.Context, phone string) (token string, isNew bool, err error) {
	rider, tok, svcErr := h.riderAuth.LoginByVerifiedPhone(ctx, phone)
	if svcErr != nil {
		if errors.Is(svcErr, riderSvc.ErrNewRider) {
			// New rider — rider is non-nil, tok is empty. Issue session for onboarding.
			tok, err = h.riderAuth.IssueSession(ctx, rider)
			return tok, true, err
		}
		return "", false, svcErr
	}
	return tok, false, nil
}

// driverFindOrCreate looks up (or creates) a driver by phone, then mints a JWT.
func (h *FirebaseAuthHandler) driverFindOrCreate(
	ctx context.Context,
	phone, email, firebaseName, reqName, reqCityPrefix string,
) (token string, isNew bool, err error) {
	var id, name, cityPrefix, verificationStatus string
	var onboardingStep int

	qErr := h.db.QueryRow(ctx, `
		SELECT id, name, city_prefix, verification_status, onboarding_step
		FROM drivers WHERE phone = $1 LIMIT 1
	`, phone).Scan(&id, &name, &cityPrefix, &verificationStatus, &onboardingStep)

	if qErr == nil {
		// Existing driver
		_, _ = h.db.Exec(ctx, "UPDATE drivers SET last_login_at = NOW(), phone_verified = true WHERE id = $1", id)
	} else if errors.Is(qErr, pgx.ErrNoRows) {
		// New driver
		isNew = true
		name = firebaseName
		if reqName != "" {
			name = reqName
		}
		if name == "" {
			name = "Driver"
		}
		cityPrefix = reqCityPrefix
		if cityPrefix == "" {
			cityPrefix = "KOL"
		}
		verificationStatus = "ONBOARDING"
		onboardingStep = 1

		// Random placeholder password_hash — Firebase-auth drivers don't use passwords.
		placeholder, _ := bcrypt.GenerateFromPassword([]byte(uuid.NewString()), bcrypt.MinCost)

		var emailVal *string
		if email != "" {
			emailVal = &email
		}
		if err = h.db.QueryRow(ctx, `
			INSERT INTO drivers (name, phone, email, password_hash, city_prefix,
			                     current_state, is_verified, onboarding_step,
			                     verification_status, phone_verified)
			VALUES ($1,$2,$3,$4,$5,'OFFLINE',false,1,'ONBOARDING',true)
			RETURNING id
		`, name, phone, emailVal, string(placeholder), cityPrefix).Scan(&id); err != nil {
			return "", false, err
		}
	} else {
		return "", false, qErr
	}

	jti := uuid.NewString()
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	claims := &middleware.CustomClaims{
		UserID:        id,
		Role:          "DRIVER",
		CityScope:     cityPrefix,
		PhoneVerified: true,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   id,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vahnly-driver-auth",
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, sErr := tok.SignedString(h.jwtSecret)
	if sErr != nil {
		return "", isNew, sErr
	}
	if h.redis != nil {
		_ = h.redis.Set(ctx, middleware.DriverSessionKey(id), jti, 7*24*time.Hour).Err()
	}
	return signed, isNew, nil
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
