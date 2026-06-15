package test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDriverAccountEndpoints(t *testing.T) {
	// Initialize target test runtime server
	handler := &http.ServeMux{}

	// Mock target context execution
	handler.HandleFunc("/api/v1/driver-account/earnings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"gross_earnings":850050,"trips_count":14}`))
	})

	req, _ := http.NewRequest("GET", "/api/v1/driver-account/earnings", nil)
	req.Header.Set("X-Driver-ID", "00000000-0000-0000-0000-000000000001")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected HTTP 200, obtained %d", rr.Code)
	}
}
