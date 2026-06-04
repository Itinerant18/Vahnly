package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDriverHandler_CompileCheck(t *testing.T) {
	var _ *DriverHandler = nil
}

func TestHandleGetDrivers_MethodValidation(t *testing.T) {
	handler := &DriverHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/drivers", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDrivers(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetDriverOnboarding_MethodValidation(t *testing.T) {
	handler := &DriverHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/drivers/onboarding", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDriverOnboarding(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetDriverDetail_MissingID(t *testing.T) {
	handler := &DriverHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/drivers/", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDriverDetail(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty driver ID, got %d", rec.Code)
	}
}

func TestHandleDriverActions_InvalidAction(t *testing.T) {
	handler := &DriverHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/drivers/123/invalid-action-slug", nil)
	rec := httptest.NewRecorder()

	handler.HandleDriverActions(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for invalid action name, got %d", rec.Code)
	}
}

func TestProjectDriverOverview_DeterministicOutputs(t *testing.T) {
	dID := "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01"
	proj := projectDriverOverview(dID, "Aniket Karmakar", "+91 9876543210", "KOL", true, "ONLINE_AVAILABLE")

	if proj.DriverID != dID {
		t.Fatalf("expected projected DriverID %s, got %s", dID, proj.DriverID)
	}
	if proj.Name != "Aniket Karmakar" {
		t.Fatalf("expected name to be projected, got %s", proj.Name)
	}
	if len(proj.KYCDocuments) == 0 {
		t.Fatalf("expected projected KYC documents, got empty")
	}
}
