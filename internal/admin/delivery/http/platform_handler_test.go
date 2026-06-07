package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlatformHandler_CompileCheck(t *testing.T) {
	var _ *PlatformHandler = NewPlatformHandler(nil, nil)
}

func TestPlatformHandler_MethodValidation(t *testing.T) {
	h := &PlatformHandler{}
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"service health rejects POST", http.MethodPost, "/api/v1/admin/platform/health", h.HandleGetServiceHealth},
		{"upsert incident rejects GET", http.MethodGet, "/api/v1/admin/platform/health/incidents", h.HandleUpsertHealthIncident},
		{"experiments rejects PUT", http.MethodPut, "/api/v1/admin/platform/experiments", h.HandleGetExperiments},
		{"upsert experiment rejects GET", http.MethodGet, "/api/v1/admin/platform/experiments", h.HandleUpsertExperiment},
		{"chatbot stats rejects POST", http.MethodPost, "/api/v1/admin/platform/chatbot", h.HandleGetChatbotStats},
		{"upsert intent rejects GET", http.MethodGet, "/api/v1/admin/platform/chatbot/intents", h.HandleUpsertChatbotIntent},
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
