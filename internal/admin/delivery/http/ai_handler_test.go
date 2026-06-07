package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAIHandler_CompileCheck(t *testing.T) {
	var _ *AIHandler = NewAIHandler(nil, nil)
}

func TestAIHandler_MethodValidation(t *testing.T) {
	h := &AIHandler{}
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"fraud events rejects POST", http.MethodPost, "/api/v1/admin/ai/fraud/events", h.HandleGetFraudEvents},
		{"update fraud event rejects GET", http.MethodGet, "/api/v1/admin/ai/fraud/events/e1", h.HandleUpdateFraudEvent},
		{"fraud rules rejects POST", http.MethodPost, "/api/v1/admin/ai/fraud/rules", h.HandleGetFraudRules},
		{"update fraud rule rejects GET", http.MethodGet, "/api/v1/admin/ai/fraud/rules/r1", h.HandleUpdateFraudRule},
		{"demand forecasts rejects POST", http.MethodPost, "/api/v1/admin/ai/demand-forecasts", h.HandleGetDemandForecasts},
		{"voc topics rejects POST", http.MethodPost, "/api/v1/admin/ai/voc/topics", h.HandleGetVoCTopics},
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
