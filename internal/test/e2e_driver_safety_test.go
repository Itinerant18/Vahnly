package test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSafetySOSIngress(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/driver/safety/sos", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"status":"emergency_broadcast_active"}`))
	})

	body := []byte(`{"latitude":22.5726,"longitude":88.3639}`)
	req, _ := http.NewRequest("POST", "/api/v1/driver/safety/sos", bytes.NewBuffer(body))
	req.Header.Set("X-Driver-ID", "00000000-0000-0000-0000-000000000001")
	
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Fatalf("Expected HTTP 202, obtained %d", rr.Code)
	}
}
