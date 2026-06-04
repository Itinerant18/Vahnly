package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVehicleHandler_CompileCheck(t *testing.T) {
	var _ *VehicleHandler = nil
}

func TestHandleGetVehicles_MethodValidation(t *testing.T) {
	handler := &VehicleHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/vehicles", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetVehicles(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleSendDocReminders_MethodValidation(t *testing.T) {
	handler := &VehicleHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/vehicles/reminders", nil)
	rec := httptest.NewRecorder()

	handler.HandleSendDocReminders(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostVehicleOverride_MissingPlate(t *testing.T) {
	handler := &VehicleHandler{}
	// In standard go net/http, the router handles path values.
	// We're invoking directly, so path value is empty.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/vehicles//override", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostVehicleOverride(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty plate, got %d", rec.Code)
	}
}

func TestProjectVehicleProperties_Deterministic(t *testing.T) {
	plate := "WB-02-TZ-1234"
	v := &Vehicle{Plate: plate}
	projectVehicleProperties(plate, v)

	if v.Model == "" {
		t.Fatalf("expected vehicle model to be projected, got empty")
	}
	if v.Type == "" {
		t.Fatalf("expected vehicle type to be projected, got empty")
	}
	if v.Year == 0 {
		t.Fatalf("expected vehicle year to be projected, got 0")
	}
	if v.RCStatus == "" || v.InsuranceStatus == "" || v.PUCStatus == "" {
		t.Fatalf("expected document statuses to be projected")
	}
	if len(v.FlaggedIssues) > 0 && v.FlaggedIssues[0] == "" {
		t.Fatalf("expected valid flagged issues list")
	}
}
