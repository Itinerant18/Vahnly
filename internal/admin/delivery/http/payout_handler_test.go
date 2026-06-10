package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPayoutHandler_CompileCheck(t *testing.T) {
	var _ *PayoutHandler = nil
}

func TestHandleGetPayouts_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/payouts", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetPayouts(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetPayoutDetail_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/payouts/po_123", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetPayoutDetail(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleBulkApprovePayouts_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/payouts/bulk-approve", nil)
	rec := httptest.NewRecorder()

	handler.HandleBulkApprovePayouts(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleExportPayoutBatch_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/payouts/export-batch", nil)
	rec := httptest.NewRecorder()

	handler.HandleExportPayoutBatch(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleRetryPayout_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/payouts/po_123/retry", nil)
	rec := httptest.NewRecorder()

	handler.HandleRetryPayout(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleHoldPayout_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/payouts/po_123/hold", nil)
	rec := httptest.NewRecorder()

	handler.HandleHoldPayout(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleReleasePayout_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/payouts/po_123/release", nil)
	rec := httptest.NewRecorder()

	handler.HandleReleasePayout(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleSettlePayout_MethodValidation(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/payouts/po_123/settle", nil)
	rec := httptest.NewRecorder()

	handler.HandleSettlePayout(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleSettlePayout_RejectsInvalidStatus(t *testing.T) {
	handler := &PayoutHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/payouts/po_123/settle",
		strings.NewReader(`{"status":"BOGUS"}`))
	req.SetPathValue("id", "po_123")
	rec := httptest.NewRecorder()

	handler.HandleSettlePayout(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid settlement status, got %d", rec.Code)
	}
}
