package middleware

import (
	"bufio"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/platform/driver-delivery/internal/observability"
)

// MetricsMiddleware records dfu_http_requests_total and
// dfu_http_request_duration_seconds for every request. It wraps the whole mux,
// so it sees the request before routing — paths are normalized (UUIDs / numeric
// IDs collapsed to {id}) to keep label cardinality bounded.
type MetricsMiddleware struct{}

func NewMetricsMiddleware() *MetricsMiddleware {
	return &MetricsMiddleware{}
}

var (
	uuidSegment = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	hexSegment  = regexp.MustCompile(`^[0-9a-fA-F]{24,}$`)
)

// normalizePath collapses high-cardinality path segments (UUIDs, long hex, pure
// numbers) into "{id}" so a metric series isn't created per entity ID.
func normalizePath(p string) string {
	if p == "" {
		return "/"
	}
	parts := strings.Split(p, "/")
	for i, seg := range parts {
		if seg == "" {
			continue
		}
		if uuidSegment.MatchString(seg) || hexSegment.MatchString(seg) || isAllDigits(seg) {
			parts[i] = "{id}"
		}
	}
	return strings.Join(parts, "/")
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// statusRecorder captures the response status code while preserving the
// Hijacker (WebSocket upgrades) and Flusher (SSE / streaming) interfaces.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wroteHeader {
		s.status = code
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.status = http.StatusOK
		s.wroteHeader = true
	}
	return s.ResponseWriter.Write(b)
}

// Hijack lets WebSocket upgrades through the recorder.
func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := s.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

func (s *statusRecorder) Flush() {
	if fl, ok := s.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

func (m *MetricsMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS preflight is noise — pass through without recording.
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		path := normalizePath(r.URL.Path)

		next.ServeHTTP(rec, r)

		elapsed := time.Since(start).Seconds()
		observability.HTTPRequestDuration.WithLabelValues(r.Method, path).Observe(elapsed)
		observability.HTTPRequestsTotal.WithLabelValues(r.Method, path, strconv.Itoa(rec.status)).Inc()
	})
}
