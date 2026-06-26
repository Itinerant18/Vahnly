package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// IdempotencyMiddleware deduplicates retried mutations (create-order, confirm-payment) by a
// client-supplied X-Idempotency-Key (a UUID). The first request runs and its successful response
// is cached under the key; a retry with the same key replays that response instead of running the
// handler again — so a double-tapped Book / Pay can't create two orders or two charges. Requests
// without the header are unaffected. Keyed by the UUID alone (unguessable), so it works regardless
// of which auth middleware fronts the route.
type IdempotencyMiddleware struct {
	client *redis.ClusterClient
	ttl    time.Duration
}

func NewIdempotencyMiddleware(client *redis.ClusterClient, ttl time.Duration) *IdempotencyMiddleware {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &IdempotencyMiddleware{client: client, ttl: ttl}
}

const idemProcessing = "__processing__"

type cachedResponse struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
}

// idemRecorder mirrors the handler's response to the real writer while buffering it for caching.
type idemRecorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (r *idemRecorder) WriteHeader(s int) {
	r.status = s
	r.ResponseWriter.WriteHeader(s)
}

func (r *idemRecorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

// Wrap returns a handler that enforces idempotency when X-Idempotency-Key is present.
func (m *IdempotencyMiddleware) Wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-Idempotency-Key")
		if key == "" || m.client == nil {
			next.ServeHTTP(w, r) // no key / no Redis — idempotency disabled, just run.
			return
		}
		redisKey := "idem:" + key

		// Claim the key with a processing marker so two concurrent duplicates can't both run.
		claimCtx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
		claimed, err := m.client.SetNX(claimCtx, redisKey, idemProcessing, m.ttl).Result()
		cancel()
		if err != nil {
			next.ServeHTTP(w, r) // Redis error — fail open (never block the mutation).
			return
		}

		if !claimed {
			// Key exists already: a cached result to replay, or a concurrent in-flight request.
			getCtx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
			val, gerr := m.client.Get(getCtx, redisKey).Result()
			cancel()
			if gerr != nil || val == "" || val == idemProcessing {
				writeConflict(w) // still processing the first request.
				return
			}
			var cached cachedResponse
			if json.Unmarshal([]byte(val), &cached) != nil {
				next.ServeHTTP(w, r) // corrupt cache entry — just run.
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotent-Replay", "true")
			w.WriteHeader(cached.Status)
			_, _ = w.Write([]byte(cached.Body))
			return
		}

		// We own the key — run the handler, capture the response, cache on success.
		rec := &idemRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		bg, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		if rec.status >= 200 && rec.status < 300 {
			payload, _ := json.Marshal(cachedResponse{Status: rec.status, Body: rec.body.String()})
			_ = m.client.Set(bg, redisKey, payload, m.ttl).Err()
		} else {
			// Failed — release the key so the user can retry cleanly.
			_ = m.client.Del(bg, redisKey).Err()
		}
	}
}

func writeConflict(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	_, _ = w.Write([]byte(`{"success":false,"code":"request_in_progress","error":"That request is already being processed. Please wait a moment."}`))
}
