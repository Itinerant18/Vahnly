package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMarketplaceOrchestratorHandler_CompileCheck(t *testing.T) {
	var _ *MarketplaceOrchestratorHandler = nil
}

func TestHandleUpsertGeofenceZone_InvalidInput(t *testing.T) {
	handler := NewMarketplaceOrchestratorHandler(nil, nil, nil)

	// Test too few coordinates
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/marketplace/geofence", strings.NewReader(`{
		"zone_name": "Test Zone",
		"city_prefix": "KOL",
		"is_active": true,
		"polygon_coordinates": [[22.5, 88.3], [22.6, 88.4]]
	}`))
	rec := httptest.NewRecorder()

	handler.HandleUpsertGeofenceZone(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for less than 3 coordinates, got %d", rec.Code)
	}

	// Test invalid JSON
	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/marketplace/geofence", strings.NewReader(`{invalid`))
	rec = httptest.NewRecorder()
	handler.HandleUpsertGeofenceZone(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for invalid JSON, got %d", rec.Code)
	}
}

func TestHandleGetGeofenceZones_MethodNotAllowed(t *testing.T) {
	handler := NewMarketplaceOrchestratorHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/marketplace/geofence", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetGeofenceZones(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 method not allowed for POST, got %d", rec.Code)
	}
}
