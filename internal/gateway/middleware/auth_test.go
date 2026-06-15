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

	t.Run("Query Parameter JWT Is Rejected", func(t *testing.T) {
		// HIGH-009: the ?jwt= query fallback was removed (tokens leak via URLs/logs).
		// Header-based routes must now reject a query-string token. WebSocket upgrades
		// authenticate via single-use tickets (see ws_ticket.go) instead.
		tokenStr := generateToken("user-query", "rider", time.Minute, []byte(secret))
		req := httptest.NewRequest("POST", "/api/v1/dispatch/stream?jwt="+tokenStr, nil)
		w := httptest.NewRecorder()

		handlerRan := false
		dummyHandler := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			handlerRan = true
			rw.WriteHeader(http.StatusOK)
		})

		authGuard.AuthenticateJWT(dummyHandler).ServeHTTP(w, req)

		if handlerRan {
			t.Error("handler must not run for a query-string token")
		}
		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401, got %d", w.Code)
		}
	})
}

func TestGetUserIDFromContext_Empty(t *testing.T) {
	_, ok := middleware.GetUserIDFromContext(context.Background())
	if ok {
		t.Error("expected ok to be false for empty context")
	}
}

func TestAuthMiddleware_RequireAnyRole(t *testing.T) {
	secret := "super_secret_signing_key_for_testing_purposes_only"
	authGuard := middleware.NewAuthMiddleware(secret)

	generateToken := func(userID, role string, d time.Duration) string {
		claims := &middleware.CustomClaims{
			UserID: userID,
			Role:   role,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(d)),
			},
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		str, _ := token.SignedString([]byte(secret))
		return str
	}

	tests := []struct {
		name           string
		authHeader     string
		allowedRoles   []string
		expectedStatus int
	}{
		{
			name:           "Valid Permitted Role (FLEET_MANAGER)",
			authHeader:     "Bearer " + generateToken("user-1", "FLEET_MANAGER", time.Minute),
			allowedRoles:   []string{"FLEET_MANAGER", "SUPER_ADMIN"},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Valid SUPER_ADMIN Bypass",
			authHeader:     "Bearer " + generateToken("user-2", "SUPER_ADMIN", time.Minute),
			allowedRoles:   []string{"FINANCIAL_AUDITOR"},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Insufficient Privileges",
			authHeader:     "Bearer " + generateToken("user-3", "FINANCIAL_AUDITOR", time.Minute),
			allowedRoles:   []string{"FLEET_MANAGER"},
			expectedStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/v1/admin/ledger", nil)
			req.Header.Set("Authorization", tt.authHeader)

			w := httptest.NewRecorder()

			dummyHandler := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
				rw.WriteHeader(http.StatusOK)
			})

			handlerToTest := authGuard.RequireAnyRole(tt.allowedRoles, dummyHandler)
			handlerToTest.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}
