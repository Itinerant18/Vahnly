package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFranchiseHandler_CompileCheck(t *testing.T) {
	var _ *FranchiseHandler = NewFranchiseHandler(nil, nil)
}

func TestFranchiseHandler_MethodValidation(t *testing.T) {
	h := &FranchiseHandler{}
	cases := []struct {
		name    string
		method  string
		path    string
		handler http.HandlerFunc
	}{
		{"tenants rejects PUT", http.MethodPut, "/api/v1/admin/franchise/tenants", h.HandleGetTenants},
		{"upsert tenant rejects GET", http.MethodGet, "/api/v1/admin/franchise/tenants", h.HandleUpsertTenant},
		{"operators rejects PUT", http.MethodPut, "/api/v1/admin/franchise/operators", h.HandleGetTenantOperators},
		{"add operator rejects GET", http.MethodGet, "/api/v1/admin/franchise/operators", h.HandleAddTenantOperator},
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
