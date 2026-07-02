package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/platform/driver-delivery/internal/domain"
)

func riderRequest(method, path string, body []byte) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	rider := &domain.Rider{ID: "00000000-0000-0000-0000-000000000001"}
	return req.WithContext(context.WithValue(req.Context(), ContextKeyRider, rider))
}

func TestMapHandlerRouteFallback(t *testing.T) {
	handler := NewMapHandler(nil, nil)
	body := []byte(`{"pickup":{"lat":22.5726,"lng":88.3639},"dropoff":{"lat":22.5850,"lng":88.4200}}`)
	rec := httptest.NewRecorder()

	handler.HandleRoute(rec, riderRequest(http.MethodPost, "/api/map/route", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Success bool             `json:"success"`
		Data    mapRouteResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !envelope.Success {
		t.Fatal("expected success envelope")
	}
	if envelope.Data.Source != "LOCAL_FALLBACK" {
		t.Fatalf("source: want LOCAL_FALLBACK, got %q", envelope.Data.Source)
	}
	if envelope.Data.DistanceMeters <= 0 || envelope.Data.DurationSeconds <= 0 {
		t.Fatalf("expected positive route metrics, got %+v", envelope.Data)
	}
	if len(envelope.Data.Geometry) != 2 {
		t.Fatalf("geometry points: want 2, got %d", len(envelope.Data.Geometry))
	}
}

func TestMapHandlerReverseGeocodeFallback(t *testing.T) {
	handler := NewMapHandler(nil, nil)
	rec := httptest.NewRecorder()

	handler.HandleReverseGeocode(rec, riderRequest(http.MethodGet, "/api/map/reverse-geocode?lat=22.5726&lng=88.3639", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Success bool          `json:"success"`
		Data    geocodeResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !envelope.Success {
		t.Fatal("expected success envelope")
	}
	if envelope.Data.DisplayName == "" || envelope.Data.Lat != 22.5726 || envelope.Data.Lng != 88.3639 {
		t.Fatalf("unexpected reverse fallback: %+v", envelope.Data)
	}
}
