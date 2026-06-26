package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiterMiddleware struct {
	clusterClient  *redis.ClusterClient
	limitCount     int64
	windowDuration time.Duration
	failClosed     bool
}

func NewRateLimiterMiddleware(client *redis.ClusterClient, limit int64, window time.Duration) *RateLimiterMiddleware {
	return &RateLimiterMiddleware{
		clusterClient:  client,
		limitCount:     limit,
		windowDuration: window,
	}
}

// SetFailClosed controls behavior when Redis is unreachable mid-request. Default is
// fail-open (preserve throughput); set true to reject (503) instead, so a degraded
// Redis can't silently disable rate limiting. The nil-client case (Redis not wired,
// e.g. dev) always fails open regardless.
func (m *RateLimiterMiddleware) SetFailClosed(v bool) { m.failClosed = v }

// windowCount runs the atomic sliding-window pipeline for a key and returns the current
// count inside the window (or an error if Redis is unreachable within the tight budget).
func (m *RateLimiterMiddleware) windowCount(ctx context.Context, key string, window time.Duration) (int64, error) {
	// Constrain context boundaries tightly to protect the <500ms platform SLA.
	redisCtx, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
	defer cancel()

	now := time.Now()
	nowMilli := now.UnixMilli()
	clearBeforeMilli := now.Add(-window).UnixMilli()

	pipe := m.clusterClient.Pipeline()
	// Evict logs older than the rolling window, append this hit, read the count, refresh TTL.
	pipe.ZRemRangeByScore(redisCtx, key, "-inf", fmt.Sprintf("%d", clearBeforeMilli))
	pipe.ZAdd(redisCtx, key, redis.Z{Score: float64(nowMilli), Member: fmt.Sprintf("%d-%d", nowMilli, now.Nanosecond())})
	cardCmd := pipe.ZCard(redisCtx, key)
	pipe.Expire(redisCtx, key, window*2)

	if _, err := pipe.Exec(redisCtx); err != nil {
		return 0, err
	}
	return cardCmd.Val(), nil
}

// LimitRouteConcurrency enforces a per-authenticated-user sliding-window limit (struct
// limit/window) across horizontal nodes. For authed endpoints only — it 403s without a user.
func (m *RateLimiterMiddleware) LimitRouteConcurrency(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := GetUserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "missing_authenticated_identity_context", http.StatusForbidden)
			return
		}
		if m.clusterClient == nil {
			next.ServeHTTP(w, r) // Redis not wired (dev) — fail open.
			return
		}
		count, err := m.windowCount(r.Context(), "ratelimit:user:"+userID, m.windowDuration)
		if err != nil {
			if m.failClosed {
				log.Printf("[RATELIMIT] redis error, failing CLOSED for user %s: %v", userID, err)
				w.Header().Set("Retry-After", "1")
				http.Error(w, "rate_limiter_unavailable", http.StatusServiceUnavailable)
				return
			}
			log.Printf("[RATELIMIT] redis error, failing OPEN for user %s: %v", userID, err)
			next.ServeHTTP(w, r)
			return
		}
		if count > m.limitCount {
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(m.windowDuration.Seconds())))
			http.Error(w, "rate_limit_exceeded_spam_blocked", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// PerKey enforces a sliding-window limit keyed by keyFn(r), with a per-call limit + window.
// Built for PRE-AUTH endpoints (OTP/login) where there is no user yet: keyFn returns the phone
// (PhoneBodyKey) or client IP (ClientIPKey). An empty key (keyFn → "") or a nil Redis client
// fails open. Honors SetFailClosed on a Redis error. Returns a JSON 429 envelope on breach.
func (m *RateLimiterMiddleware) PerKey(keyFn func(*http.Request) string, prefix string, limit int64, window time.Duration) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			if key == "" || m.clusterClient == nil {
				next.ServeHTTP(w, r) // no key (e.g. body had no phone) or no Redis — fail open.
				return
			}
			count, err := m.windowCount(r.Context(), fmt.Sprintf("ratelimit:%s:%s", prefix, key), window)
			if err != nil {
				if m.failClosed {
					log.Printf("[RATELIMIT] redis error, failing CLOSED for %s:%s: %v", prefix, key, err)
					writeRateLimited(w, 1)
					return
				}
				log.Printf("[RATELIMIT] redis error, failing OPEN for %s:%s: %v", prefix, key, err)
				next.ServeHTTP(w, r)
				return
			}
			if count > limit {
				writeRateLimited(w, int(window.Seconds()))
				return
			}
			next.ServeHTTP(w, r)
		}
	}
}

// writeRateLimited emits a structured JSON 429 the apps can surface as a friendly message.
func writeRateLimited(w http.ResponseWriter, retryAfterSec int) {
	w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfterSec))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	// Envelope shape matches the apps' ApiEnvelope: {success, error:<string>, code:<string>}.
	_, _ = w.Write([]byte(`{"success":false,"code":"rate_limited","error":"Too many attempts. Please wait a bit and try again."}`))
}

// ClientIPKey extracts the client IP, preferring the first X-Forwarded-For hop (set by the
// Caddy reverse proxy in prod), else the connection's RemoteAddr host.
func ClientIPKey(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// PhoneBodyKey reads the phone from the JSON body (phone / phone_number / mobile) and rebuffers
// the body so the handler can still read it. Returns "" (→ fail open / skip phone limit) if the
// body has no phone field — the paired IP limit still applies. Body read is capped at 64KB.
func PhoneBodyKey(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	// Always rebuffer, even on a partial read, so the handler sees the same bytes.
	r.Body = io.NopCloser(bytes.NewReader(body))
	if err != nil {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(body, &m) != nil {
		return ""
	}
	for _, k := range []string{"phone", "phone_number", "mobile"} {
		if v, ok := m[k].(string); ok {
			if p := normalizePhone(v); p != "" {
				return p
			}
		}
	}
	return ""
}

// normalizePhone reduces a phone to its last 10 digits so "+91 98765 43210" and "9876543210"
// map to the same limit key.
func normalizePhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if len(d) > 10 {
		d = d[len(d)-10:]
	}
	return d
}
