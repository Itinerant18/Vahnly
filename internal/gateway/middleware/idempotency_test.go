package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Without a key, or without Redis, the middleware must pass straight through (fail open) — it must
// never block a mutation just because idempotency can't be enforced.
func TestIdempotency_PassthroughWithoutKeyOrRedis(t *testing.T) {
	m := NewIdempotencyMiddleware(nil, 0) // nil Redis client
	called := 0
	h := m.Wrap(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	})

	// No X-Idempotency-Key header → pass through.
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/x", nil))
	if called != 1 || w.Code != http.StatusOK {
		t.Fatalf("no-key should pass through: called=%d code=%d", called, w.Code)
	}

	// Key present but nil client → still pass through (no Redis to dedup against).
	r := httptest.NewRequest(http.MethodPost, "/x", nil)
	r.Header.Set("X-Idempotency-Key", "abc")
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, r)
	if called != 2 || w2.Code != http.StatusOK {
		t.Fatalf("nil-client should pass through with a key: called=%d code=%d", called, w2.Code)
	}
}
