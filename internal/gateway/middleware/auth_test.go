package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

func TestAuthMiddleware_AuthenticateJWT(t *testing.T) {
	secret := "super_secret_signing_key_for_testing_purposes_only"
	authGuard := middleware.NewAuthMiddleware(secret)

	// Helper to generate a test token
	generateToken := func(userID, role string, d time.Duration, key interface{}) string {
		claims := &middleware.CustomClaims{
			UserID: userID,
			Role:   role,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(d)),
			},
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		str, _ := token.SignedString(key)
		return str
	}

	tests := []struct {
		name           string
		authHeader     string
		expectedStatus int
		expectedUser   string
	}{
		{
			name:           "Valid Token NYC User",
			authHeader:     "Bearer " + generateToken("user-123", "rider", time.Minute, []byte(secret)),
			expectedStatus: http.StatusOK,
			expectedUser:   "user-123",
		},
		{
			name:           "Missing Authorization Header",
			authHeader:     "",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Invalid Authorization Format",
			authHeader:     "TokenXYZ",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Wrong Secret Key",
			authHeader:     "Bearer " + generateToken("user-123", "rider", time.Minute, []byte("wrong_secret")),
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Expired Token",
			authHeader:     "Bearer " + generateToken("user-123", "rider", -time.Minute, []byte(secret)),
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/orders", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}

			w := httptest.NewRecorder()

			// Dummy handler to assert successful authentication
			var capturedUserID string
			dummyHandler := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
				var ok bool
				capturedUserID, ok = middleware.GetUserIDFromContext(r.Context())
				if !ok {
					t.Error("expected user ID in context but got none")
				}
				rw.WriteHeader(http.StatusOK)
			})

			handlerToTest := authGuard.AuthenticateJWT(dummyHandler)
			handlerToTest.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.expectedStatus == http.StatusOK && capturedUserID != tt.expectedUser {
				t.Errorf("expected user ID %s, got %s", tt.expectedUser, capturedUserID)
			}
		})
	}
}

func TestGetUserIDFromContext_Empty(t *testing.T) {
	_, ok := middleware.GetUserIDFromContext(context.Background())
	if ok {
		t.Error("expected ok to be false for empty context")
	}
}
