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
	UserID string `json:"user_id"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func NewAuthMiddleware(secret string) *AuthMiddleware {
	return &AuthMiddleware{jwtSecretKey: []byte(secret)}
}

func extractToken(r *http.Request) (string, string, bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		jwtParam := r.URL.Query().Get("jwt")
		if jwtParam == "" {
			return "", "missing_authorization_header", false
		}
		return jwtParam, "", true
	}
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return "", "invalid_authorization_format", false
	}
	return parts[1], "", true
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
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// GetUserIDFromContext extracts target credentials safely inside downstream handlers
func GetUserIDFromContext(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(UserIDContextKey).(string)
	return userID, ok
}

const UserRoleContextKey ContextKey = "userRole"

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
