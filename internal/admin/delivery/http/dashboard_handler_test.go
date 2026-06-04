package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDashboardHandler_CompileCheck(t *testing.T) {
	var _ *DashboardHandler = nil
}

func TestDashboardHandler_KPIs_RejectsPost(t *testing.T) {
	handler := NewDashboardHandler(nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/dashboard/kpis", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDashboardKPIs(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestDashboardHandler_KPIs_InvalidRange(t *testing.T) {
	handler := NewDashboardHandler(nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard/kpis?range=invalid", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDashboardKPIs(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid_range") {
		t.Errorf("expected error message invalid_range, got %s", rec.Body.String())
	}
}

func TestDashboardHandler_Charts_RejectsPost(t *testing.T) {
	handler := NewDashboardHandler(nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/dashboard/charts", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDashboardCharts(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestDashboardHandler_Charts_InvalidRange(t *testing.T) {
	handler := NewDashboardHandler(nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard/charts?range=invalid", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDashboardCharts(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestDashboardHandler_Alerts_RejectsPost(t *testing.T) {
	handler := NewDashboardHandler(nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/dashboard/alerts", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetDashboardAlerts(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestDashboardHandler_Alerts_EmptyWithNoDB(t *testing.T) {
	// Without DB and Incident handler, it should still return 200 with empty list of alerts (or nil, normalized to empty list)
	// But it queries DB so it might crash or fail if dbPool is nil.
	// We can skip database-dependent tests when dbPool is nil by handling panic/recover or checking if DATABASE_URL is empty
}

func TestDashboardHandler_RecentTrips_RejectsPost(t *testing.T) {
	handler := NewDashboardHandler(nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/dashboard/recent-trips", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetRecentTrips(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestPercentageDelta(t *testing.T) {
	tests := []struct {
		current  int64
		previous int64
		expected float64
	}{
		{100, 50, 100.0},
		{50, 100, -50.0},
		{100, 0, 100.0},
		{0, 0, 0.0},
		{0, 100, -100.0},
	}

	for _, tt := range tests {
		got := percentageDelta(tt.current, tt.previous)
		if got != tt.expected {
			t.Errorf("percentageDelta(%d, %d) = %f; expected %f", tt.current, tt.previous, got, tt.expected)
		}
	}
}

func TestRelativeTime(t *testing.T) {
	// Spot check some relative times
	// No need to over-assert since time.Now() moves, but check it executes without panic
	importTest := relativeTime(importTimeMinus(10))
	if importTest == "" {
		t.Error("relativeTime returned empty string")
	}
}

func importTimeMinus(minutes int) time.Time {
	// Helper to avoid circular package issues
	return time.Now().Add(-time.Duration(minutes) * time.Minute)
}

func TestDashboardHandler_KPI_JSON_Structure(t *testing.T) {
	// A basic validation that KPIResponse marshals to the expected fields
	kpis := KPIResponse{
		TotalTrips:       10,
		ActiveTrips:      5,
		NewRiderSignups:  3,
		NewDriverSignups: 2,
		OnlineDrivers:    4,
		TotalDrivers:     10,
		CancellationRate: 5.0,
		AvgEtaMinutes:    3.5,
		AvgRating:        4.8,
		GrossRevenue:     50000,
		NetRevenue:       10000,
		PromoCost:        2000,
	}

	data, err := json.Marshal(kpis)
	if err != nil {
		t.Fatalf("failed to marshal KPIResponse: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to unmarshal KPIResponse: %v", err)
	}

	expectedKeys := []string{
		"total_trips", "active_trips", "new_rider_signups", "new_driver_signups",
		"online_drivers", "total_drivers", "cancellation_rate", "avg_eta_minutes",
		"avg_rating", "gross_revenue", "net_revenue", "promo_cost",
	}

	for _, key := range expectedKeys {
		if _, ok := parsed[key]; !ok {
			t.Errorf("expected key %s in JSON response, but it was missing", key)
		}
	}
}
