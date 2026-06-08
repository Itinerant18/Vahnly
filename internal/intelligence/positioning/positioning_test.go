package positioning

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProjectDemand(t *testing.T) {
	cases := []struct {
		name    string
		samples []float64
		horizon int
		want    float64
	}{
		{"empty series projects zero", nil, 3, 0},
		{"single sample returns itself", []float64{5}, 3, 5},
		{"linear rise extrapolates up", []float64{2, 4, 6}, 2, 10},   // slope 2, last 6, +2*2
		{"linear fall floors at zero", []float64{10, 6, 2}, 3, 0},    // slope -4, last 2, +(-4*3)=-10 -> 0
		{"flat series stays flat", []float64{7, 7, 7, 7}, 5, 7},      // slope 0
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ProjectDemand(tc.samples, tc.horizon); got != tc.want {
				t.Errorf("ProjectDemand(%v, %d) = %v, want %v", tc.samples, tc.horizon, got, tc.want)
			}
		})
	}
}

// TestNudgeHandlerValidation covers the request-validation paths that reject
// before any Redis access, so they run without infrastructure.
func TestNudgeHandlerValidation(t *testing.T) {
	h := NewNudgeHTTPHandler(&FleetRebalancer{cityPrefix: "KOL"})

	cases := []struct {
		name       string
		method     string
		body       string
		wantStatus int
	}{
		{"GET rejected", http.MethodGet, "", http.StatusMethodNotAllowed},
		{"malformed JSON", http.MethodPost, "{not json", http.StatusBadRequest},
		{"missing target", http.MethodPost, `{"source_h3_cell":"abc"}`, http.StatusBadRequest},
		{"missing source", http.MethodPost, `{"target_h3_cell":"abc"}`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/internal/surge/nudge", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d (body=%q)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}
