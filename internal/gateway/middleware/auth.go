package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ContextKey string
const UserIDContextKey ContextKey = "userID"

type AuthMiddleware struct {
	jwtSecretKey []byte
}

type CustomClaims struct {
	UserID    string `json:"user_id"`
	Role      string `json:"role"`
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
	// Bearer header only. The ?jwt= query fallback was removed: tokens in URLs leak
	// into access/proxy logs, history, and Referer headers. WebSocket upgrades (which
	// cannot set headers) now authenticate via single-use tickets — see ws_ticket.go.
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", "missing_authorization_header", false
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return "", "invalid_authorization_format", false
	}
	return parts[1], "", true
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

		// Inject verified user context fields into the request context pipeline
		ctx := context.WithValue(r.Context(), UserIDContextKey, claims.UserID)
		ctx = context.WithValue(ctx, UserRoleContextKey, claims.Role)
		ctx = context.WithValue(ctx, CityScopeContextKey, claims.CityScope)
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

			claims := &CustomClaims{}
			_, _ = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
				return m.jwtSecretKey, nil
			})

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

			r.Header.Set("X-Admin-Role", claims.Role)
			next.ServeHTTP(w, r)
		})(w, r)
	}
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

			claims := &CustomClaims{}
			_, _ = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
				return m.jwtSecretKey, nil
			})

			if claims.TwoFactorPending {
				http.Error(w, "two_factor_enrolment_incomplete", http.StatusForbidden)
				return
			}

			claimsRole := strings.ToUpper(claims.Role)
			if claimsRole == "SUPER_ADMIN" {
				r.Header.Set("X-Admin-Role", claims.Role)
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

			r.Header.Set("X-Admin-Role", claims.Role)
			next.ServeHTTP(w, r)
		})(w, r)
	}
}
