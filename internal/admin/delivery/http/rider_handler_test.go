package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRiderHandler_CompileCheck(t *testing.T) {
	var _ *RiderHandler = nil
}

func TestHandleGetRiders_MethodValidation(t *testing.T) {
	handler := &RiderHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/riders", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetRiders(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetRiderDetail_MissingID(t *testing.T) {
	handler := &RiderHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/riders/", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetRiderDetail(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty rider ID, got %d", rec.Code)
	}
}

func TestHandleRiderActions_InvalidAction(t *testing.T) {
	handler := &RiderHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/riders/123/invalid-action-slug", nil)
	rec := httptest.NewRecorder()

	handler.HandleRiderActions(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for invalid action name, got %d", rec.Code)
	}
}

func TestProjectRider_DeterministicOutputs(t *testing.T) {
	cID := "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01"
	proj := projectRider(cID)

	if proj.CustomerID != cID {
		t.Fatalf("expected projected CustomerID %s, got %s", cID, proj.CustomerID)
	}
	if proj.Name == "" {
		t.Fatalf("expected name to be projected deterministically, got empty string")
	}
	if proj.Phone == "" || !strings.HasPrefix(proj.Phone, "+91") {
		t.Fatalf("expected valid projected phone, got %s", proj.Phone)
	}
	if proj.Email == "" || !strings.Contains(proj.Email, "@") {
		t.Fatalf("expected valid projected email, got %s", proj.Email)
	}
	if len(proj.Overview.Addresses) == 0 {
		t.Fatalf("expected projected addresses, got empty")
	}
}
