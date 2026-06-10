package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIncidentAdminHandler_CompileCheck(t *testing.T) {
	var _ *IncidentAdminHandler = nil
}

func TestHandleClaimIncident_RBAC(t *testing.T) {
	handler := NewIncidentAdminHandler(nil, nil, []string{"localhost:9092"}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/trips/claim", strings.NewReader(`{
		"order_id": "ord-9011-cb72",
		"agent_id": "agent-777"
	}`))
	rec := httptest.NewRecorder()

	// Missing header X-Admin-Role should fail with Forbidden (403)
	handler.HandleClaimIncident(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 forbidden, got %d", rec.Code)
	}

	// Invalid role should fail
	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/trips/claim", strings.NewReader(`{
		"order_id": "ord-9011-cb72",
		"agent_id": "agent-777"
	}`))
	req.Header.Set("X-Admin-Role", "FLEET_MANAGER")
	rec = httptest.NewRecorder()
	handler.HandleClaimIncident(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 forbidden for FLEET_MANAGER, got %d", rec.Code)
	}
}

func TestHandleClaimIncident_Validation(t *testing.T) {
	handler := NewIncidentAdminHandler(nil, nil, []string{"localhost:9092"}, nil)
	
	// Test missing fields
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/trips/claim", strings.NewReader(`{
		"order_id": "",
		"agent_id": "agent-777"
	}`))
	req.Header.Set("X-Admin-Role", "SUPER_ADMIN")
	rec := httptest.NewRecorder()
	handler.HandleClaimIncident(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 unprocessable, got %d", rec.Code)
	}

	// Test malformed JSON
	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/trips/claim", strings.NewReader(`{malformed`))
	req.Header.Set("X-Admin-Role", "SUPER_ADMIN")
	rec = httptest.NewRecorder()
	handler.HandleClaimIncident(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request, got %d", rec.Code)
	}
}

// NOTE: the claim+get success round-trip is now Redis-backed (the in-memory seed was
// removed for production durability — see SYNC-007). It requires a live/mock Redis and
// is therefore covered by integration tests, not this unit suite.

func TestHandleClaimIncident_NotFound(t *testing.T) {
	handler := NewIncidentAdminHandler(nil, nil, []string{"localhost:9092"}, nil)
	
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/trips/claim", strings.NewReader(`{
		"order_id": "non-existent-order",
		"agent_id": "agent-777"
	}`))
	req.Header.Set("X-Admin-Role", "SUPER_ADMIN")
	rec := httptest.NewRecorder()
	handler.HandleClaimIncident(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 not found, got %d", rec.Code)
	}
}
