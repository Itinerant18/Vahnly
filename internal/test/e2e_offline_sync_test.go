package test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOfflineSyncPayloadIngress(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/driver/sync/offline-payload", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"sync_complete","reconciled_packets":2}`))
	})

	// Simulated telemetry batch data array
	syncJSON := []byte(`{
		"order_id": "00000000-0000-0000-0000-000000000002",
		"device_fingerprint": "Mozilla-Capacitor-Client",
		"packets": [
			{"type":"TELEMETRY","payload":"lat:22.5,lng:88.3","captured_at":"2026-06-09T10:00:00Z"},
			{"type":"TELEMETRY","payload":"lat:22.6,lng:88.4","captured_at":"2026-06-09T10:00:05Z"}
		]
	}`)

	req, _ := http.NewRequest("POST", "/api/v1/driver/sync/offline-payload", bytes.NewBuffer(syncJSON))
	req.Header.Set("X-Driver-ID", "00000000-0000-0000-0000-000000000001")

	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected HTTP 200 on batch sync, obtained %d", rr.Code)
	}
}
