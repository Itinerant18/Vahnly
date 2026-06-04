package http

import (
	"encoding/json"
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

func TestHandleClaimIncident_Success(t *testing.T) {
	handler := NewIncidentAdminHandler(nil, nil, []string{"localhost:9092"}, nil)
	
	// Claim WB-02-AL-0011 which is OrderID ord-9011-cb72
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/trips/claim", strings.NewReader(`{
		"order_id": "ord-9011-cb72",
		"agent_id": "agent-777"
	}`))
	req.Header.Set("X-Admin-Role", "SUPER_ADMIN")
	rec := httptest.NewRecorder()
	handler.HandleClaimIncident(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	// Verify that GET stalled trips returns updated status and assigned agent ID
	reqGet := httptest.NewRequest(http.MethodGet, "/api/v1/admin/trips/stalled", nil)
	reqGet.Header.Set("X-Admin-Role", "SUPPORT_LEAD")
	recGet := httptest.NewRecorder()
	handler.HandleGetStalledTrips(recGet, reqGet)

	if recGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET, got %d", recGet.Code)
	}

	var resp struct {
		Incidents []StalledTripIncident `json:"incidents"`
	}
	if err := json.Unmarshal(recGet.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal GET response: %v", err)
	}

	found := false
	for _, inc := range resp.Incidents {
		if inc.OrderID == "ord-9011-cb72" {
			found = true
			if inc.IncidentStatus != "INVESTIGATING" {
				t.Errorf("expected incident status INVESTIGATING, got %s", inc.IncidentStatus)
			}
			if inc.AssignedAgentID != "agent-777" {
				t.Errorf("expected assigned agent ID agent-777, got %s", inc.AssignedAgentID)
			}
		}
	}

	if !found {
		t.Errorf("could not find incident ord-9011-cb72 in response list")
	}
}

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
