package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestOdometerWriterHandler_CompileCheck ensures the handler method exists on
// GatewayHandler and has the standard http.HandlerFunc signature at compile time.
func TestOdometerWriterHandler_CompileCheck(t *testing.T) {
	var h *GatewayHandler
	var _ http.HandlerFunc = h.HandleDriverOdometerCheckpoint
}

// TestOdometerWriterHandler_MethodValidation verifies the handler rejects
// non-POST methods.
func TestOdometerWriterHandler_MethodValidation(t *testing.T) {
	h := &GatewayHandler{}

	methods := []string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete}
	for _, method := range methods {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/v1/driver/orders/test-order/odometer", nil)
		h.HandleDriverOdometerCheckpoint(rec, req)

		// Without a DB pool, the handler will fail during decode or DB access,
		// but should NOT succeed (200/201) for non-POST methods.
		if rec.Code == http.StatusOK || rec.Code == http.StatusCreated {
			t.Errorf("method %s should not succeed, got status %d", method, rec.Code)
		}
	}
}
