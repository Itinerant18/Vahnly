package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDriverOpsHandler_CompileCheck(t *testing.T) {
	var _ *DriverOpsHandler = NewDriverOpsHandler(nil, nil)
}

func TestDriverOpsHandler_MethodValidation(t *testing.T) {
	h := &DriverOpsHandler{}
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"incentives rejects PUT", http.MethodPut, "/api/v1/admin/driver-ops/incentives", h.HandleGetIncentiveCampaigns},
		{"upsert incentive rejects GET", http.MethodGet, "/api/v1/admin/driver-ops/incentives", h.HandleUpsertIncentiveCampaign},
		{"coaching flags rejects POST", http.MethodPost, "/api/v1/admin/driver-ops/coaching/flags", h.HandleGetCoachingFlags},
		{"resolve flag rejects GET", http.MethodGet, "/api/v1/admin/driver-ops/coaching/flags/f1/resolve", h.HandleResolveCoachingFlag},
		{"training modules rejects POST", http.MethodPost, "/api/v1/admin/driver-ops/coaching/modules", h.HandleGetTrainingModules},
		{"inspections rejects POST", http.MethodPost, "/api/v1/admin/driver-ops/inspections", h.HandleGetInspections},
		{"review inspection rejects GET", http.MethodGet, "/api/v1/admin/driver-ops/inspections/i1/review", h.HandleReviewInspection},
		{"telematics events rejects POST", http.MethodPost, "/api/v1/admin/driver-ops/telematics/events", h.HandleGetTelematicsEvents},
		{"telematics summaries rejects POST", http.MethodPost, "/api/v1/admin/driver-ops/telematics/summaries", h.HandleGetTelematicsSummaries},
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
