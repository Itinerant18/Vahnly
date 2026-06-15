package http

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPromoHandler_CompileCheck(t *testing.T) {
	var _ *PromoHandler = nil
}

func TestHandleGetPromos_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/promos", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetPromos(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostPromo_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/promos", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostPromo(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostPromosBulk_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/promos/bulk", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostPromosBulk(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostPromoState_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/promos/SAVE30/state", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostPromoState(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetPromoAnalytics_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/promos/SAVE30/analytics", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetPromoAnalytics(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetBanners_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/promos/banners", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetBanners(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostBanners_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/promos/banners", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostBanners(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetReferralSettings_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/promos/referral", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetReferralSettings(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostReferralSettings_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/promos/referral", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostReferralSettings(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetLoyaltySettings_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/promos/loyalty", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetLoyaltySettings(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostLoyaltySettings_MethodValidation(t *testing.T) {
	logger := log.New(io.Discard, "", 0)
	handler := NewPromoHandler(nil, nil, logger)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/promos/loyalty", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostLoyaltySettings(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}
