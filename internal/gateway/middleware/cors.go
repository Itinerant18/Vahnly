package middleware

import (
	"net/http"
	"os"
	"strings"
)

type CORSMiddleware struct{}

func NewCORSMiddleware() *CORSMiddleware {
	return &CORSMiddleware{}
}

func (c *CORSMiddleware) Handler(next http.Handler) http.Handler {
	// The admin frontend origin that is permitted to send credentialed (cookie) requests.
	// Same-origin deployments leave this empty and never trigger CORS at all.
	allowedOrigin := strings.TrimRight(os.Getenv("ADMIN_FRONTEND_URL"), "/")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Credentialed requests cannot use a wildcard origin. Echo the request origin only
		// when it matches the configured admin frontend, and allow credentials so the
		// session cookie is accepted cross-origin.
		if allowedOrigin != "" && origin == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		} else {
			// Non-credentialed cross-origin reads keep the permissive wildcard.
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Region-Prefix, X-Idempotency-Key, X-Admin-Role, X-Admin-Email, X-Admin-ID")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
