package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
	"github.com/redis/go-redis/v9"
)

func TestRateLimiterMiddleware_LimitRouteConcurrency_MissingContext(t *testing.T) {
	// Setup middleware with nil Redis Cluster Client (should fail open under normal circumstances, but here we expect Forbidden due to missing context)
	rateLimiter := middleware.NewRateLimiterMiddleware(nil, 5, time.Minute)

	req := httptest.NewRequest("POST", "/api/v1/orders", nil)
	w := httptest.NewRecorder()

	dummyHandler := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.WriteHeader(http.StatusOK)
	})

	handlerToTest := rateLimiter.LimitRouteConcurrency(dummyHandler)
	handlerToTest.ServeHTTP(w, req)

	// Since context is missing authenticated userID, it should return Forbidden (403)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected status %d, got %d", http.StatusForbidden, w.Code)
	}
}

func TestRateLimiterMiddleware_LimitRouteConcurrency_FailOpenGracefully(t *testing.T) {
	// Setup with a disconnected/nil client to verify it fails open gracefully when Redis cluster has anomalies
	var nilClient *redis.ClusterClient
	rateLimiter := middleware.NewRateLimiterMiddleware(nilClient, 5, time.Minute)

	req := httptest.NewRequest("POST", "/api/v1/orders", nil)

	// Inject authenticated user ID into context
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "user-abc")
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()

	dummyHandler := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.WriteHeader(http.StatusOK)
	})

	handlerToTest := rateLimiter.LimitRouteConcurrency(dummyHandler)
	handlerToTest.ServeHTTP(w, req)

	// Since Redis is nil, it should fail open gracefully (returning 200 OK)
	if w.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d", http.StatusOK, w.Code)
	}
}
