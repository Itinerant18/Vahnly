package http

import (
	"context"
	"net/http"
	"strings"

	"github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/rider/service"
)

// contextKey is unexported so only this package can set the rider context value.
type contextKey string

// ContextKeyRider is the request-context key under which the authenticated
// *domain.Rider is stored. It is intentionally distinct from the driver/admin
// auth keys — rider auth does not share middleware with them.
const ContextKeyRider contextKey = "rider"

// RiderAuthMiddleware validates rider JWTs via the rider AuthService and injects
// the resolved rider into the request context. It is standalone: it does not
// reuse the gateway AuthMiddleware used by driver/admin routes.
type RiderAuthMiddleware struct {
	auth *service.AuthService
}

func NewRiderAuthMiddleware(auth *service.AuthService) *RiderAuthMiddleware {
	return &RiderAuthMiddleware{auth: auth}
}

// Require wraps a handler so it only runs for a valid, RIDER-scoped session.
func (m *RiderAuthMiddleware) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "missing bearer token", "ERR_UNAUTHENTICATED")
			return
		}
		rider, err := m.auth.RiderFromJWT(r.Context(), token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired session", "ERR_UNAUTHENTICATED")
			return
		}
		ctx := context.WithValue(r.Context(), ContextKeyRider, rider)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// GetRiderFromContext returns the authenticated rider injected by Require.
func GetRiderFromContext(ctx context.Context) (*domain.Rider, bool) {
	rider, ok := ctx.Value(ContextKeyRider).(*domain.Rider)
	return rider, ok
}

// bearerToken extracts a non-empty Bearer token from the Authorization header.
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		token := strings.TrimSpace(parts[1])
		if token != "" && token != "null" {
			return token
		}
	}
	return ""
}
