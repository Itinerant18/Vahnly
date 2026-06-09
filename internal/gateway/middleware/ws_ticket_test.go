package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const wsTestSecret = "ws-ticket-unit-test-secret"

func signWSToken(t *testing.T, userID, role, scope string) string {
	t.Helper()
	claims := &CustomClaims{
		UserID: userID, Role: role, CityScope: scope,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(wsTestSecret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

// No ticket and no token → rejected. Closes the door the ?jwt= fallback opened
// once that transitional branch is eventually removed.
func TestWSTicket_RejectsWithoutCredentials(t *testing.T) {
	m := NewWSTicketMiddleware(nil, NewAuthMiddleware(wsTestSecret))
	called := false
	h := m.Authenticate(func(w http.ResponseWriter, r *http.Request) { called = true })

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/v1/dispatch/stream", nil))

	if called {
		t.Fatal("handler should not run without credentials")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

// Transitional ?jwt= fallback authenticates and injects identity into context.
func TestWSTicket_JWTFallbackInjectsIdentity(t *testing.T) {
	m := NewWSTicketMiddleware(nil, NewAuthMiddleware(wsTestSecret))
	token := signWSToken(t, "drv-1", "DRIVER", "KOL")

	var gotID, gotScope string
	h := m.Authenticate(func(w http.ResponseWriter, r *http.Request) {
		gotID, _ = GetUserIDFromContext(r.Context())
		gotScope, _ = GetCityScopeFromContext(r.Context())
	})

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/v1/dispatch/stream?jwt="+token, nil))

	if gotID != "drv-1" || gotScope != "KOL" {
		t.Fatalf("identity not injected: id=%q scope=%q", gotID, gotScope)
	}
}

// A ticket presented with no ticket store available fails closed (503), never open.
func TestWSTicket_TicketWithoutStoreFailsClosed(t *testing.T) {
	m := NewWSTicketMiddleware(nil, NewAuthMiddleware(wsTestSecret))
	called := false
	h := m.Authenticate(func(w http.ResponseWriter, r *http.Request) { called = true })

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/v1/dispatch/stream?ticket=abc", nil))

	if called {
		t.Fatal("handler must not run when ticket store is unavailable")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", rec.Code)
	}
}
