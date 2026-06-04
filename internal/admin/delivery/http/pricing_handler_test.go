package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPricingAdminHandler_CompileCheck(t *testing.T) {
	var _ *PricingAdminHandler = nil
}

func TestHandleGetFares_MethodValidation(t *testing.T) {
	handler := &PricingAdminHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/pricing/fares", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetFares(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetFareHistory_MethodValidation(t *testing.T) {
	handler := &PricingAdminHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/pricing/fares/history", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetFareHistory(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostFare_MethodValidation(t *testing.T) {
	handler := &PricingAdminHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/pricing/fares", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostFare(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleRevertFare_MethodValidation(t *testing.T) {
	handler := &PricingAdminHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/pricing/fares/revert", nil)
	rec := httptest.NewRecorder()

	handler.HandleRevertFare(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetSurgeRules_MethodValidation(t *testing.T) {
	handler := &PricingAdminHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/pricing/surge/rules", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetSurgeRules(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetCommission_MethodValidation(t *testing.T) {
	handler := &PricingAdminHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/pricing/commission", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetCommission(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}
