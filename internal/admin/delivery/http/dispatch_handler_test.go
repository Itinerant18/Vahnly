package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDispatchHandler_CompileCheck(t *testing.T) {
	var _ *DispatchHandler = nil
}

func TestHandleGetCities_MethodValidation(t *testing.T) {
	handler := &DispatchHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/dispatch/cities", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetCities(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostCity_MethodValidation(t *testing.T) {
	handler := &DispatchHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dispatch/cities", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostCity(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetDispatchRules_MissingCity(t *testing.T) {
	handler := &DispatchHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dispatch/rules/", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDispatchRules(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty city prefix, got %d", rec.Code)
	}
}

func TestHandlePostDispatchRules_MissingCity(t *testing.T) {
	handler := &DispatchHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/dispatch/rules/", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostDispatchRules(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty city prefix, got %d", rec.Code)
	}
}
