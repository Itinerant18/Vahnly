package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestESGHandler_CompileCheck(t *testing.T) {
	var _ *ESGHandler = NewESGHandler(nil, nil)
}

func TestESGHandler_MethodValidation(t *testing.T) {
	h := &ESGHandler{}
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"summary rejects POST", http.MethodPost, "/api/v1/admin/esg/summary", h.HandleGetESGSummary},
		{"publish report rejects GET", http.MethodGet, "/api/v1/admin/esg/reports/r1/publish", h.HandlePublishESGReport},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c.handler(rec, httptest.NewRequest(c.method, c.path, nil))
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected 405, got %d", rec.Code)
			}
		})
	}
}
