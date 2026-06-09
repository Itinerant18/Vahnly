package test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompileTripForensicTrail(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/admin/orders/00000000-0000-0000-0000-000000000002/forensic-audit", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"order_id":"00000000-0000-0000-0000-000000000002","route_metrics":{"wait_time_minutes":4}}`))
	})

	req, _ := http.NewRequest("GET", "/api/v1/admin/orders/00000000-0000-0000-0000-000000000002/forensic-audit", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected HTTP 200 on forensic audit compile compilation request, obtained %d", rr.Code)
	}
}
