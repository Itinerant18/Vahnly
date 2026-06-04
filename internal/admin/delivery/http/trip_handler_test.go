package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminTripHandler_CompileCheck(t *testing.T) {
	var _ *AdminTripHandler = nil
}

func TestAdminTripHandler_CancelRejectsGet(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders/cancel", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminCancelOrder(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminTripHandler_CancelMalformedBody(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orders/cancel", strings.NewReader(`malformed`))
	rec := httptest.NewRecorder()

	handler.HandleAdminCancelOrder(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestAdminTripHandler_CreateRejectsGet(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminCreateTrip(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminTripHandler_CreateMalformedBody(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orders", strings.NewReader(`malformed`))
	rec := httptest.NewRecorder()

	handler.HandleAdminCreateTrip(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestAdminTripHandler_CreateMissingFields(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	// Missing pickup/dropoff coordinates
	body := `{"city_prefix": "KOL", "base_fare_paise": 5000}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orders", strings.NewReader(body))
	rec := httptest.NewRecorder()

	handler.HandleAdminCreateTrip(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 Unprocessable Entity, got %d", rec.Code)
	}
}

func TestAdminTripHandler_ReopenRejectsGet(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders/123/reopen", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminReopenTrip(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminTripHandler_ReassignRejectsGet(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders/123/reassign", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminReassignTrip(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminTripHandler_ReassignMalformedBody(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orders/123/reassign", strings.NewReader(`malformed`))
	rec := httptest.NewRecorder()

	handler.HandleAdminReassignTrip(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestAdminTripHandler_FraudRejectsGet(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders/123/fraud", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminMarkFraud(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminTripHandler_SendInvoiceRejectsGet(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders/123/send-invoice", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminSendInvoice(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminTripHandler_SendInvoiceSuccess(t *testing.T) {
	handler := NewAdminTripHandler(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/orders/123/send-invoice", nil)
	req.SetPathValue("id", "123")
	rec := httptest.NewRecorder()

	handler.HandleAdminSendInvoice(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if resp["status"] != "success" || !strings.Contains(resp["message"], "Invoice") {
		t.Errorf("unexpected body payload: %v", resp)
	}
}
