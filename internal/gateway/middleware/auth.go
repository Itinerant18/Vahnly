package middleware

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// adminSessionCookie holds the admin JWT as an HttpOnly cookie so it is never readable by
// JavaScript — this closes the localStorage XSS exposure (CRIT-004). The admin SPA is
// served same-origin, so the cookie is sent automatically on every API/WS request.
const adminSessionCookie = "admin_session"

// adminCookieSecure controls the Secure flag. Default true (production HTTPS); set
// ADMIN_COOKIE_SECURE=false for local http development so the cookie is still stored.
func adminCookieSecure() bool {
	return os.Getenv("ADMIN_COOKIE_SECURE") != "false"
}

// SetSessionCookie writes the admin session JWT as an HttpOnly, SameSite=Lax cookie.
func SetSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   adminCookieSecure(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   12 * 60 * 60, // 12h, matches the admin token TTL
	})
}

// ClearSessionCookie expires the admin session cookie on logout.
func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   adminCookieSecure(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

type ContextKey string
const UserIDContextKey ContextKey = "userID"

// DriverSessionTTL bounds a driver login session; matches the driver JWT expiry.
const DriverSessionTTL = 24 * time.Hour

// DriverSessionKey is the Redis key holding the active session jti for a driver.
// Written at login, checked by the session validator wired in cmd/gateway, and
// deleted by admin suspend/block actions for instant revocation.
func DriverSessionKey(driverID string) string {
	return "driver:session:" + driverID
}

type AuthMiddleware struct {
	jwtSecretKey []byte
	// sessionCheck optionally validates that a token's session is still active
	// (server-side revocation). Wired per-deployment via SetSessionValidator;
	// nil means no revocation check (backwards compatible).
	sessionCheck func(ctx context.Context, claims *CustomClaims) bool
}

// SetSessionValidator installs a server-side session check invoked after
// signature validation. Returning false rejects the request with 401.
func (m *AuthMiddleware) SetSessionValidator(fn func(ctx context.Context, claims *CustomClaims) bool) {
	m.sessionCheck = fn
}

type CustomClaims struct {
	UserID    string `json:"user_id"`
	Role      string `json:"role"`
	Email     string `json:"email,omitempty"`
	CityScope string `json:"city_scope,omitempty"`
	// TwoFactorPending marks an enrolment-scoped token issued when an admin has 2FA
	// enabled but no TOTP secret on file. The RBAC guards reject it for everything
	// except the /2fa/enroll endpoint, so it cannot reach protected admin data.
	TwoFactorPending bool `json:"two_factor_pending,omitempty"`
	jwt.RegisteredClaims
}

func NewAuthMiddleware(secret string) *AuthMiddleware {
	return &AuthMiddleware{jwtSecretKey: []byte(secret)}
}

func extractToken(r *http.Request) (string, string, bool) {
	// Prefer a valid Bearer header (driver app / API clients). The ?jwt= query fallback was
	// removed: tokens in URLs leak into logs/history/Referer. WebSocket upgrades authenticate
	// via single-use tickets — see ws_ticket.go.
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" && parts[1] != "" && parts[1] != "null" {
			return parts[1], "", true
		}
	}

	// Fall back to the HttpOnly admin session cookie. Same-origin requests send it
	// automatically, so the admin SPA never keeps the JWT in JS-readable storage.
	if ck, err := r.Cookie(adminSessionCookie); err == nil && ck.Value != "" {
		return ck.Value, "", true
	}

	if authHeader == "" {
		return "", "missing_authorization_header", false
	}
	return "", "invalid_authorization_format", false
}

// ValidateToken parses and verifies an HS256 token, returning its claims if valid.
// Shared by the JWT middleware and the WS-ticket transitional fallback.
func (m *AuthMiddleware) ValidateToken(tokenStr string) (*CustomClaims, bool) {
	claims := &CustomClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected_signing_method: %v", t.Header["alg"])
		}
		return m.jwtSecretKey, nil
	})
	if err != nil || !token.Valid {
		return nil, false
	}
	return claims, true
}

// InjectClaims puts verified identity into the request context. Shared by JWT and
// WS-ticket auth so downstream handlers and the region router see the same keys.
func InjectClaims(ctx context.Context, c *CustomClaims) context.Context {
	ctx = context.WithValue(ctx, UserIDContextKey, c.UserID)
	ctx = context.WithValue(ctx, UserRoleContextKey, c.Role)
	ctx = context.WithValue(ctx, CityScopeContextKey, c.CityScope)
	ctx = context.WithValue(ctx, TwoFactorPendingContextKey, c.TwoFactorPending)
	return ctx
}

// AuthenticateJWT intercepts HTTP traffic and validates cryptographic access tokens
func (m *AuthMiddleware) AuthenticateJWT(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokenStr, errMsg, ok := extractToken(r)
		if !ok {
			http.Error(w, errMsg, http.StatusUnauthorized)
			return
		}

		claims := &CustomClaims{}

		token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected_signing_method: %v", token.Header["alg"])
			}
			return m.jwtSecretKey, nil
		})

		if err != nil || !token.Valid {
			http.Error(w, "cryptographic_token_validation_failed", http.StatusUnauthorized)
			return
		}

		// Server-side session revocation check (e.g. driver suspended by admin).
		if m.sessionCheck != nil && !m.sessionCheck(r.Context(), claims) {
			http.Error(w, "session_revoked_or_expired", http.StatusUnauthorized)
			return
		}

		// Inject verified user context fields into the request context pipeline
		ctx := context.WithValue(r.Context(), UserIDContextKey, claims.UserID)
		ctx = context.WithValue(ctx, UserRoleContextKey, claims.Role)
		ctx = context.WithValue(ctx, CityScopeContextKey, claims.CityScope)
		ctx = context.WithValue(ctx, TwoFactorPendingContextKey, claims.TwoFactorPending)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// GetUserIDFromContext extracts target credentials safely inside downstream handlers
func GetUserIDFromContext(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(UserIDContextKey).(string)
	return userID, ok
}

const UserRoleContextKey ContextKey = "userRole"

func GetUserRoleFromContext(ctx context.Context) (string, bool) {
	role, ok := ctx.Value(UserRoleContextKey).(string)
	return role, ok
}

const CityScopeContextKey ContextKey = "cityScope"

const TwoFactorPendingContextKey ContextKey = "twoFactorPending"

// GetTwoFactorPendingFromContext reports whether the session is an enrolment-scoped token
// (2FA enabled, no TOTP secret on file). Such a session may only reach /2fa/enroll.
func GetTwoFactorPendingFromContext(ctx context.Context) bool {
	v, _ := ctx.Value(TwoFactorPendingContextKey).(bool)
	return v
}

// GetCityScopeFromContext returns the raw city_scope claim (e.g. "KOL" or "KOL,BLR").
func GetCityScopeFromContext(ctx context.Context) (string, bool) {
	scope, ok := ctx.Value(CityScopeContextKey).(string)
	return scope, ok
}

// RequireRole guards administrative routes against non-authorized client access
func (m *AuthMiddleware) RequireRole(targetRole string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		m.AuthenticateJWT(func(w http.ResponseWriter, r *http.Request) {
			// Extract verified user claims mapped into context during token validation
			tokenStr, _, ok := extractToken(r)
			if !ok {
				http.Error(w, "missing_authorization_header", http.StatusUnauthorized)
				return
			}

			claims, valid := m.ValidateToken(tokenStr)
			if !valid {
				http.Error(w, "cryptographic_token_validation_failed", http.StatusUnauthorized)
				return
			}

			if claims.TwoFactorPending {
				http.Error(w, "two_factor_enrolment_incomplete", http.StatusForbidden)
				return
			}

			claimsRole := strings.ToUpper(claims.Role)
			targetRoleUpper := strings.ToUpper(targetRole)

			if claimsRole != "SUPER_ADMIN" && claimsRole != targetRoleUpper {
				http.Error(w, "access_denied_insufficient_administrative_privileges", http.StatusForbidden)
				return
			}

			setVerifiedAdminHeaders(r, claims)
			next.ServeHTTP(w, r)
		})(w, r)
	}
}

// setVerifiedAdminHeaders overwrites the actor-identity headers with values taken
// from the cryptographically verified JWT claims. Using Set (not Add) replaces any
// client-supplied X-Admin-* header, so handlers can never be fed a forged actor.
func setVerifiedAdminHeaders(r *http.Request, claims *CustomClaims) {
	r.Header.Set("X-Admin-Role", claims.Role)
	r.Header.Set("X-Admin-ID", claims.UserID)
	r.Header.Set("X-Admin-Email", claims.Email)
}

// RequireAnyRole guards administrative routes against non-authorized client access for a list of permitted roles
func (m *AuthMiddleware) RequireAnyRole(allowedRoles []string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		m.AuthenticateJWT(func(w http.ResponseWriter, r *http.Request) {
			tokenStr, _, ok := extractToken(r)
			if !ok {
				http.Error(w, "missing_authorization_header", http.StatusUnauthorized)
				return
			}

			claims, valid := m.ValidateToken(tokenStr)
			if !valid {
				http.Error(w, "cryptographic_token_validation_failed", http.StatusUnauthorized)
				return
			}

			if claims.TwoFactorPending {
				http.Error(w, "two_factor_enrolment_incomplete", http.StatusForbidden)
				return
			}

			claimsRole := strings.ToUpper(claims.Role)
			if claimsRole == "SUPER_ADMIN" {
				setVerifiedAdminHeaders(r, claims)
				next.ServeHTTP(w, r)
				return
			}

			isAllowed := false
			for _, allowedRole := range allowedRoles {
				if claimsRole == strings.ToUpper(allowedRole) {
					isAllowed = true
					break
				}
			}

			if !isAllowed {
				http.Error(w, "access_denied_insufficient_administrative_privileges", http.StatusForbidden)
				return
			}

			setVerifiedAdminHeaders(r, claims)
			next.ServeHTTP(w, r)
		})(w, r)
	}
}
