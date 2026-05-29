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

// AuthenticateJWT intercepts HTTP traffic and validates cryptographic access tokens
func (m *AuthMiddleware) AuthenticateJWT(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "missing_authorization_header", http.StatusUnauthorized)
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			http.Error(w, "invalid_authorization_format", http.StatusUnauthorized)
			return
		}

		tokenStr := parts[1]
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
			authHeader := r.Header.Get("Authorization")
			parts := strings.Split(authHeader, " ")
			tokenStr := parts[1]

			claims := &CustomClaims{}
			_, _ = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
				return m.jwtSecretKey, nil
			})

			if strings.ToUpper(claims.Role) != strings.ToUpper(targetRole) {
				http.Error(w, "access_denied_insufficient_administrative_privileges", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})(w, r)
	}
}
