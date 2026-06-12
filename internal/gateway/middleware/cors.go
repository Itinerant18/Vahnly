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
	// Closed allow-list of browser origins permitted to read responses cross-origin.
	// No wildcard: an origin not on the list gets no Access-Control-Allow-Origin header,
	// so the browser blocks the response. Sources (deduped):
	//   - ADMIN_FRONTEND_URL (the credentialed admin SPA)
	//   - CORS_ALLOWED_ORIGINS (comma-separated; production frontend origins)
	//   - sensible localhost dev defaults (admin :5173, driver :3000, rider :3050)
	allowed := map[string]bool{
		"http://localhost:5173": true,
		"http://localhost:3000": true,
		"http://localhost:3050": true,
	}
	if admin := strings.TrimRight(os.Getenv("ADMIN_FRONTEND_URL"), "/"); admin != "" {
		allowed[admin] = true
	}
	for _, o := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			allowed[o] = true
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Only reflect an origin that is explicitly allow-listed, and pair it with
		// Allow-Credentials so the admin session cookie is accepted. Unknown origins
		// receive no ACAO header at all (browser blocks) — never a wildcard.
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Region-Prefix, X-Idempotency-Key, X-Admin-Role, X-Admin-Email, X-Admin-ID")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
