package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiterMiddleware struct {
	clusterClient *redis.ClusterClient
	limitCount     int64
	windowDuration time.Duration
}

func NewRateLimiterMiddleware(client *redis.ClusterClient, limit int64, window time.Duration) *RateLimiterMiddleware {
	return &RateLimiterMiddleware{
		clusterClient:  client,
		limitCount:     limit,
		windowDuration: window,
	}
}

// LimitRouteConcurrency enforces distributed tracking limits across horizontal pod nodes
func (m *RateLimiterMiddleware) LimitRouteConcurrency(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := GetUserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "missing_authenticated_identity_context", http.StatusForbidden)
			return
		}

		// UNBRACKETED KEY DESIGN: Scatters rate limit load uniformly across all master nodes
		rateLimitKey := fmt.Sprintf("ratelimit:user:%s", userID)

		now := time.Now()
		nowMilli := now.UnixMilli()
		clearBeforeMilli := now.Add(-m.windowDuration).UnixMilli()

		// Constrain context boundaries tightly to protect the <500ms platform SLA
		redisCtx, cancel := context.WithTimeout(r.Context(), 20*time.Millisecond)
		defer cancel()

		if m.clusterClient == nil {
			// Fail open gracefully to preserve marketplace booking throughput if Redis is uninitialized
			next.ServeHTTP(w, r)
			return
		}

		// Execute atomic precision sliding logs within a single multi-command round-trip pipeline
		pipe := m.clusterClient.Pipeline()
		
		// Remove logs older than the current rolling temporal boundary window
		pipe.ZRemRangeByScore(redisCtx, rateLimitKey, "-inf", fmt.Sprintf("%d", clearBeforeMilli))
		// Log the current inbound hit trace event timestamp
		pipe.ZAdd(redisCtx, rateLimitKey, redis.Z{Score: float64(nowMilli), Member: fmt.Sprintf("%d-%d", nowMilli, now.Nanosecond())})
		// Read current size profile density matching active log constraints
		cardCmd := pipe.ZCard(redisCtx, rateLimitKey)
		// Maintain defensive cache memory longevity TTL barriers
		pipe.Expire(redisCtx, rateLimitKey, m.windowDuration*2)

		_, err := pipe.Exec(redisCtx)
		if err != nil {
			// Fail open gracefully to preserve marketplace booking throughput if cache latency anomalies arise
			next.ServeHTTP(w, r)
			return
		}

		currentUsageCount := cardCmd.Val()
		if currentUsageCount > m.limitCount {
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(m.windowDuration.Seconds())))
			http.Error(w, "rate_limit_exceeded_spam_blocked", http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	}
}
