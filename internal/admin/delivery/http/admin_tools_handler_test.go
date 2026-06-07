package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminToolsHandler_CompileCheck(t *testing.T) {
	var _ *AdminToolsHandler = NewAdminToolsHandler(nil, nil)
}

func TestAdminToolsHandler_MethodValidation(t *testing.T) {
	h := &AdminToolsHandler{}
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"impersonation list rejects PUT", http.MethodPut, "/api/v1/admin/tools/impersonation", h.HandleGetImpersonationSessions},
		{"start impersonation rejects GET", http.MethodGet, "/api/v1/admin/tools/impersonation", h.HandleStartImpersonation},
		{"end impersonation rejects GET", http.MethodGet, "/api/v1/admin/tools/impersonation/s1/end", h.HandleEndImpersonation},
		{"bulk ops rejects POST", http.MethodPost, "/api/v1/admin/tools/bulk-operations", h.HandleGetBulkOperations},
		{"approve bulk rejects GET", http.MethodGet, "/api/v1/admin/tools/bulk-operations/b1/approve", h.HandleApproveBulkOperation},
		{"cron jobs rejects PUT", http.MethodPut, "/api/v1/admin/tools/cron-jobs", h.HandleGetCronJobs},
		{"toggle cron rejects GET", http.MethodGet, "/api/v1/admin/tools/cron-jobs/c1/toggle", h.HandleToggleCronJob},
		{"export queries rejects POST", http.MethodPost, "/api/v1/admin/tools/exports/queries", h.HandleGetExportQueries},
		{"export jobs rejects PUT", http.MethodPut, "/api/v1/admin/tools/exports/jobs", h.HandleGetExportJobs},
		{"submit export rejects GET", http.MethodGet, "/api/v1/admin/tools/exports/jobs", h.HandleSubmitExportJob},
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
