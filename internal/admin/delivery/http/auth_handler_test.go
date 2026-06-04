package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminAuthHandler_CompileCheck(t *testing.T) {
	var _ *AdminAuthHandler = nil
}

func TestAdminAuthHandler_LoginRejectsGet(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/auth/login", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminLogin(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_LoginMalformedBody(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/auth/login", strings.NewReader(`malformed`))
	rec := httptest.NewRecorder()

	handler.HandleAdminLogin(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_RegisterRejectsGet(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/auth/register", nil)
	rec := httptest.NewRecorder()

	handler.HandleAdminRegister(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_RegisterMissingFields(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/auth/register", strings.NewReader(`{
		"full_name": "Sarah Connor",
		"email": ""
	}`))
	rec := httptest.NewRecorder()

	handler.HandleAdminRegister(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_ListAdminsRejectsPost(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/team", nil)
	rec := httptest.NewRecorder()

	handler.HandleListAdmins(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_InviteAdminRejectsGet(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/team/invite", nil)
	rec := httptest.NewRecorder()

	handler.HandleInviteAdmin(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_InviteAdminMissingEmail(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/team/invite", strings.NewReader(`{
		"full_name": "T-800",
		"role": "FLEET_MANAGER"
	}`))
	rec := httptest.NewRecorder()

	handler.HandleInviteAdmin(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_EditRoleRejectsGet(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/team/edit-role", nil)
	rec := httptest.NewRecorder()

	handler.HandleEditRole(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_SuspendAdminRejectsGet(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/team/suspend", nil)
	rec := httptest.NewRecorder()

	handler.HandleSuspendAdmin(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_Reset2FARejectsGet(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/team/reset-2fa", nil)
	rec := httptest.NewRecorder()

	handler.HandleReset2FA(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestAdminAuthHandler_GetAuditLogsRejectsPost(t *testing.T) {
	handler := NewAdminAuthHandler(nil, "jwtsecret")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/team/audit", nil)
	rec := httptest.NewRecorder()

	handler.HandleGetAuditLogs(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestIsValidRole(t *testing.T) {
	validRoles := []string{"SUPER_ADMIN", "OPERATIONS_MANAGER", "FLEET_MANAGER", "CUSTOMER_SUPPORT", "FINANCE", "MARKETING", "ANALYTICS", "CITY_MANAGER", "COMPLIANCE", "AUDITOR"}
	for _, role := range validRoles {
		if !isValidRole(role) {
			t.Errorf("expected %s to be valid", role)
		}
	}

	invalidRoles := []string{"MOCK_ROLE", "DEVELOPER", "GUEST", ""}
	for _, role := range invalidRoles {
		if isValidRole(role) {
			t.Errorf("expected %s to be invalid", role)
		}
	}
}
