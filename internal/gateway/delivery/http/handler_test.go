package http

import (
	"context"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

func TestGatewayHandler_CompileCheck(t *testing.T) {
	// A simple compile-time type-safety check for GatewayHandler creation
	var _ *GatewayHandler = nil
}

func TestDriverLocationRouteRequiresJWT(t *testing.T) {
	authGuard := middleware.NewAuthMiddleware("test-secret")
	handlerCalled := false

	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/location", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()

	authGuard.AuthenticateJWT(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		handlerCalled = true
	})(rec, req)

	if handlerCalled {
		t.Fatal("expected auth middleware to block request before handler")
	}
	if rec.Code != stdhttp.StatusUnauthorized {
		t.Fatalf("expected 401 for missing JWT, got %d", rec.Code)
	}
}

func TestHandleDriverLocationUpdateRejectsDriverMismatch(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/location", strings.NewReader(`{
		"driver_id":"driver-b",
		"city_prefix":"KOL",
		"latitude":22.5726,
		"longitude":88.3639,
		"bearing":12,
		"speed_kms":24
	}`))
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-a")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "DRIVER")
	rec := httptest.NewRecorder()

	handler.HandleDriverLocationUpdate(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403 for driver mismatch, got %d", rec.Code)
	}
}

func TestHandleDriverLocationUpdateReportsMissingRedisClient(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/location", strings.NewReader(`{
		"driver_id":"driver-a",
		"city_prefix":"KOL",
		"latitude":22.5726,
		"longitude":88.3639,
		"bearing":12,
		"speed_kms":24
	}`))
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-a")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "DRIVER")
	rec := httptest.NewRecorder()

	handler.HandleDriverLocationUpdate(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusServiceUnavailable {
		t.Fatalf("expected 503 for missing Redis client, got %d", rec.Code)
	}
}

func TestHandleDriverLogin_MissingCredentials(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/auth/driver/login", strings.NewReader(`{"phone":""}`))
	rec := httptest.NewRecorder()

	handler.HandleDriverLogin(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 bad request, got %d", rec.Code)
	}
}

func TestHandleDriverGetProfile_RequiresDriverRole(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodGet, "/api/v1/driver/me", nil)
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-123")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "RIDER")
	rec := httptest.NewRecorder()

	handler.HandleDriverGetProfile(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403 forbidden, got %d", rec.Code)
	}
}

func TestHandleDriverSetStatus_MismatchedIdentity(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/status", strings.NewReader(`{"driver_id":"mismatch-id","status":"ONLINE_AVAILABLE"}`))
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-123")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "DRIVER")
	rec := httptest.NewRecorder()

	handler.HandleDriverSetStatus(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403 forbidden, got %d", rec.Code)
	}
}

func TestHandleDriverSetStatus_InvalidStatus(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/status", strings.NewReader(`{"driver_id":"driver-123","status":"BUSY"}`))
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-123")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "DRIVER")
	rec := httptest.NewRecorder()

	handler.HandleDriverSetStatus(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 bad request, got %d", rec.Code)
	}
}

func TestHandleRegisterDeviceToken_Validation(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/device-token", strings.NewReader(`{"device_token":"","platform_type":"ANDROID_FCM"}`))
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-123")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "DRIVER")
	rec := httptest.NewRecorder()

	handler.HandleRegisterDeviceToken(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 bad request for empty token, got %d", rec.Code)
	}

	req2 := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/driver/device-token", strings.NewReader(`{"device_token":"token-123","platform_type":"WEB"}`))
	rec2 := httptest.NewRecorder()
	handler.HandleRegisterDeviceToken(rec2, req2.WithContext(ctx))

	if rec2.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 bad request for invalid platform type, got %d", rec2.Code)
	}
}

func TestHandleDriverGetEarnings_MissingFromTo(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodGet, "/api/v1/driver/earnings", nil)
	ctx := context.WithValue(req.Context(), middleware.UserIDContextKey, "driver-123")
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, "DRIVER")
	rec := httptest.NewRecorder()

	handler.HandleDriverGetEarnings(rec, req.WithContext(ctx))

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 bad request for missing parameters, got %d", rec.Code)
	}
}

func TestHandleTriggerSOS_ValidRequest(t *testing.T) {
	handler := &GatewayHandler{}

	callbackCalled := false
	SOSCallback = func(tripID string, lat, lng float64) {
		if tripID == "trp-123" && lat == 22.5 && lng == 88.5 {
			callbackCalled = true
		}
	}
	defer func() { SOSCallback = nil }()

	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/sos/trigger", strings.NewReader(`{
		"trip_id": "trp-123",
		"latitude": 22.5,
		"longitude": 88.5
	}`))
	rec := httptest.NewRecorder()

	handler.HandleTriggerSOS(rec, req)

	if rec.Code != stdhttp.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	if !callbackCalled {
		t.Fatal("expected SOSCallback to be invoked with request coordinates")
	}
}

func TestHandleTriggerSOS_MissingTripID(t *testing.T) {
	handler := &GatewayHandler{}
	req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/sos/trigger", strings.NewReader(`{
		"trip_id": "",
		"latitude": 22.5,
		"longitude": 88.5
	}`))
	rec := httptest.NewRecorder()

	handler.HandleTriggerSOS(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d", rec.Code)
	}
}
