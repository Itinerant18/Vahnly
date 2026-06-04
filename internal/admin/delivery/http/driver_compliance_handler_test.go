package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDriverComplianceHandler_CompileCheck(t *testing.T) {
	var _ *DriverComplianceHandler = nil
}

func TestHandleGetPendingDriverDetail_Validation(t *testing.T) {
	handler := &DriverComplianceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/drivers/pending/", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetPendingDriverDetail(rec, req)

	// Since we are not using path values in raw httptest without a router, PathValue will be empty
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty path variable, got %d", rec.Code)
	}
}

func TestHandleDuplicateCheck_InvalidField(t *testing.T) {
	handler := &DriverComplianceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/validation/duplicate-check", strings.NewReader(`{
		"field_name": "invalid_field_name",
		"value": "123"
	}`))
	rec := httptest.NewRecorder()

	handler.HandleDuplicateCheck(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for invalid field_name, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "unsupported_validation_field") {
		t.Fatalf("expected error msg, got %s", rec.Body.String())
	}
}

func TestHandleVerifyDriver_BackgroundCheckNotCleared(t *testing.T) {
	handler := &DriverComplianceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/drivers/verify", strings.NewReader(`{
		"driver_id": "drv-123",
		"approve": true,
		"has_manual_certification": true,
		"has_automatic_certification": true,
		"is_luxury_qualified": false,
		"background_check_status": "PENDING"
	}`))
	rec := httptest.NewRecorder()

	handler.HandleVerifyDriver(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for un-cleared background check, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "background_check_clearance_required") {
		t.Fatalf("expected background clearance error, got %s", rec.Body.String())
	}
}

func TestHandleVerifyDriver_NoCapabilityProvided(t *testing.T) {
	handler := &DriverComplianceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/drivers/verify", strings.NewReader(`{
		"driver_id": "drv-123",
		"approve": true,
		"has_manual_certification": false,
		"has_automatic_certification": false,
		"is_luxury_qualified": false,
		"background_check_status": "CLEARED"
	}`))
	rec := httptest.NewRecorder()

	handler.HandleVerifyDriver(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for zero capabilities, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "transmission_capability_required") {
		t.Fatalf("expected transmission capability error, got %s", rec.Body.String())
	}
}

func TestHandleGetDriversInCell_MissingCell(t *testing.T) {
	handler := &DriverComplianceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics/cells//drivers", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDriversInCell(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for missing cell path parameter, got %d", rec.Code)
	}
}
