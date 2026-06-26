package http

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// RefreshHandler issues a new access token from a valid refresh token (P1). The refresh token is
// rotated on every use (replay-protected). Public route — the refresh token itself is the credential.
type RefreshHandler struct {
	dbPool    *pgxpool.Pool
	redis     *redis.ClusterClient
	jwtSecret []byte
}

func NewRefreshHandler(db *pgxpool.Pool, rc *redis.ClusterClient, secret string) *RefreshHandler {
	return &RefreshHandler{dbPool: db, redis: rc, jwtSecret: []byte(secret)}
}

func (h *RefreshHandler) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeRefreshUnauthorized(w)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	role, userID, newRefresh, err := middleware.RotateRefreshToken(ctx, h.redis, req.RefreshToken)
	if err != nil {
		writeRefreshUnauthorized(w)
		return
	}

	if role == "RIDER" {
		var isActive bool
		if qErr := h.dbPool.QueryRow(ctx, `SELECT is_active FROM riders WHERE id = $1::uuid`, userID).Scan(&isActive); qErr != nil || !isActive {
			writeRefreshUnauthorized(w)
			return
		}
		expiresAt := time.Now().Add(middleware.AccessTokenTTL())
		jti := uuid.NewString()
		claims := &middleware.CustomClaims{
			UserID: userID,
			Role:   "RIDER",
			RegisteredClaims: jwt.RegisteredClaims{
				ID:        jti,
				Subject:   userID,
				ExpiresAt: jwt.NewNumericDate(expiresAt),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				Issuer:    "vahnly-rider-auth",
			},
		}
		access, sErr := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.jwtSecret)
		if sErr != nil {
			writeRefreshUnauthorized(w)
			return
		}
		if h.redis != nil {
			_ = h.redis.Set(ctx, "rider:session:"+userID, jti, middleware.RefreshTokenTTL).Err()
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"token":         access,
			"refresh_token": newRefresh,
			"expires_at":    expiresAt,
			"role":          "RIDER",
			"rider_id":      userID,
		})
		return
	}

	if role != "DRIVER" {
		writeRefreshUnauthorized(w)
		return
	}

	// Rebuild the driver's claims from the source of truth.
	var cityPrefix, verificationStatus, name string
	var onboardingStep int
	var phoneVerified bool
	if err := h.dbPool.QueryRow(ctx, `
		SELECT city_prefix, verification_status, onboarding_step, phone_verified, name
		FROM drivers WHERE id = $1::uuid`, userID).
		Scan(&cityPrefix, &verificationStatus, &onboardingStep, &phoneVerified, &name); err != nil {
		writeRefreshUnauthorized(w)
		return
	}

	expiresAt := time.Now().Add(middleware.AccessTokenTTL())
	jti := uuid.NewString()
	claims := &middleware.CustomClaims{
		UserID:        userID,
		Role:          "DRIVER",
		CityScope:     cityPrefix,
		PhoneVerified: phoneVerified,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vahnly-driver-auth",
		},
	}
	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.jwtSecret)
	if err != nil {
		writeRefreshUnauthorized(w)
		return
	}
	if h.redis != nil {
		_ = h.redis.Set(ctx, middleware.DriverSessionKey(userID), jti, middleware.RefreshTokenTTL).Err()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"token":               access,
		"refresh_token":       newRefresh,
		"expires_at":          expiresAt,
		"role":                "DRIVER",
		"driver_id":           userID,
		"name":                name,
		"phone_verified":      phoneVerified,
		"onboarding_step":     onboardingStep,
		"verification_status": verificationStatus,
	})
}

// HandleLogoutAll revokes every session for the authenticated user: all refresh tokens + the session
// jti (which kills all access tokens). role is fixed per route ("DRIVER" / "RIDER").
func (h *RefreshHandler) HandleLogoutAll(role string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := middleware.GetUserIDFromContext(r.Context())
		if !ok || userID == "" {
			writeRefreshUnauthorized(w)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		middleware.RevokeAllRefreshTokens(ctx, h.redis, role, userID)
		if h.redis != nil {
			if role == "RIDER" {
				_ = h.redis.Del(ctx, "rider:session:"+userID).Err()
			} else {
				_ = h.redis.Del(ctx, middleware.DriverSessionKey(userID)).Err()
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Logged out of all devices."})
	}
}

func writeRefreshUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"success":false,"code":"refresh_invalid","error":"Session expired. Please log in again."}`))
}
