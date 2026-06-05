package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFinanceHandler_CompileCheck(t *testing.T) {
	var _ *FinanceHandler = nil
}

func TestHandleGetTransactions_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/transactions", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetTransactions(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetTransactionDetail_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/transactions/txn_123", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetTransactionDetail(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetRefunds_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/refunds", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetRefunds(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostRefund_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/refunds", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostRefund(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleApproveRefund_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/refunds/ref_123/approve", nil)
	rec := httptest.NewRecorder()

	handler.HandleApproveRefund(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleRejectRefund_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/refunds/ref_123/reject", nil)
	rec := httptest.NewRecorder()

	handler.HandleRejectRefund(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetWallets_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/wallets", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetWallets(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetWalletDetail_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/wallets/wall_123", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetWalletDetail(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostWalletAdjustment_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/wallets/wall_123/adjust", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostWalletAdjustment(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetInvoices_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/invoices", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetInvoices(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleExportInvoices_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/invoices/export", nil)
	rec := httptest.NewRecorder()

	handler.HandleExportInvoices(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetReconciliation_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/reconciliation", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetReconciliation(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetCashCollect_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/reconciliation/cash-collect", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetCashCollect(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostDailyClose_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/reconciliation/daily-close", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostDailyClose(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandleGetDisputes_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/finance/disputes", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDisputes(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}

func TestHandlePostDisputeEvidence_MethodValidation(t *testing.T) {
	handler := &FinanceHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/finance/disputes/disp_123/evidence", nil)
	rec := httptest.NewRecorder()

	handler.HandlePostDisputeEvidence(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed, got %d", rec.Code)
	}
}
