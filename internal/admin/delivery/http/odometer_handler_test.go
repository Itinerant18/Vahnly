package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOdometerHandler_CompileCheck(t *testing.T) {
	var _ *OdometerHandler = NewOdometerHandler(nil, nil)
}

func TestOdometerHandler_MethodValidation(t *testing.T) {
	h := &OdometerHandler{}
	cases := []struct {
		name    string
		method  string
		handler http.HandlerFunc
	}{
		{"get audit rejects POST", http.MethodPost, h.HandleGetOdometerAudit},
		{"patch audit rejects GET", http.MethodGet, h.HandlePatchOdometerAudit},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c.handler(rec, httptest.NewRequest(c.method, "/api/v1/admin/orders/o1/odometer-audit", nil))
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected 405, got %d", rec.Code)
			}
		})
	}
}

func TestRound2(t *testing.T) {
	cases := map[float64]float64{
		1.234:  1.23,
		1.235:  1.24,
		-8.765: -8.77,
		10:     10,
	}
	for in, want := range cases {
		if got := round2(in); got != want {
			t.Errorf("round2(%v) = %v, want %v", in, got, want)
		}
	}
}
