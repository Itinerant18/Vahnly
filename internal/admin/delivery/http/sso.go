package http

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// Google Workspace SSO via raw OAuth2 (authorization-code flow), stdlib only —
// no golang.org/x/oauth2 dependency. The flow is gated on three env vars; when
// any is unset the endpoints return 503 so the deployment can run password-only.

const (
	googleAuthURL     = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL    = "https://oauth2.googleapis.com/token"
	googleUserInfoURL = "https://www.googleapis.com/oauth2/v2/userinfo"
)

func ssoConfig() (clientID, clientSecret, redirectURL string, ok bool) {
	clientID = os.Getenv("GOOGLE_OAUTH_CLIENT_ID")
	clientSecret = os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET")
	redirectURL = os.Getenv("GOOGLE_OAUTH_REDIRECT_URL")
	ok = clientID != "" && clientSecret != "" && redirectURL != ""
	return
}

// frontendURL is where the callback bounces the browser after minting a token.
func frontendURL() string {
	if u := os.Getenv("ADMIN_FRONTEND_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return "http://localhost:3000"
}

func randomState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// HandleSSOGoogleStart redirects the browser to Google's consent screen.
func (h *AdminAuthHandler) HandleSSOGoogleStart(w http.ResponseWriter, r *http.Request) {
	clientID, _, redirectURL, ok := ssoConfig()
	if !ok {
		http.Error(w, "sso_not_configured", http.StatusServiceUnavailable)
		return
	}

	state := randomState()
	// CSRF guard: stash the state in a short-lived cookie and echo it back on callback.
	http.SetCookie(w, &http.Cookie{
		Name:     "admin_sso_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	v := url.Values{}
	v.Set("client_id", clientID)
	v.Set("redirect_uri", redirectURL)
	v.Set("response_type", "code")
	v.Set("scope", "openid email profile")
	v.Set("state", state)
	v.Set("access_type", "online")
	v.Set("prompt", "select_account")

	http.Redirect(w, r, googleAuthURL+"?"+v.Encode(), http.StatusFound)
}

type googleTokenResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
}

type googleUserInfo struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
}

// HandleSSOGoogleCallback exchanges the auth code, resolves the admin by verified
// email, links the SSO identity, and bounces back to the dashboard with a JWT.
func (h *AdminAuthHandler) HandleSSOGoogleCallback(w http.ResponseWriter, r *http.Request) {
	clientID, clientSecret, redirectURL, ok := ssoConfig()
	if !ok {
		http.Error(w, "sso_not_configured", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	ip := getClientIP(r)
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" {
		http.Error(w, "missing_code", http.StatusBadRequest)
		return
	}

	// CSRF: state query param must match the cookie set at start.
	stateCookie, err := r.Cookie("admin_sso_state")
	if err != nil || stateCookie.Value == "" || stateCookie.Value != state {
		http.Error(w, "invalid_state", http.StatusBadRequest)
		return
	}

	info, err := exchangeGoogleCode(ctx, clientID, clientSecret, redirectURL, code)
	if err != nil {
		h.recordAuditLog(ctx, "", "", "SSO_FAILURE", "Google code exchange failed: "+err.Error(), ip)
		http.Error(w, "sso_exchange_failed", http.StatusUnauthorized)
		return
	}
	if !info.VerifiedEmail || info.Email == "" {
		http.Error(w, "email_not_verified", http.StatusUnauthorized)
		return
	}

	// Resolve admin by email. SSO never auto-creates admins — the account must
	// already exist and be active (provisioned via the team invite flow).
	var dbUserID, dbRole string
	var dbIsActive bool
	lookErr := h.dbPool.QueryRow(ctx,
		"SELECT id, role, is_active FROM system_admins WHERE email = $1", info.Email,
	).Scan(&dbUserID, &dbRole, &dbIsActive)
	if lookErr != nil {
		h.recordAuditLog(ctx, "", info.Email, "SSO_FAILURE", "No admin account for SSO email", ip)
		http.Error(w, "sso_account_not_provisioned", http.StatusForbidden)
		return
	}
	if !dbIsActive {
		http.Error(w, "account_suspended", http.StatusForbidden)
		return
	}

	// Link the Google identity on first successful SSO login.
	_, _ = h.dbPool.Exec(ctx,
		"UPDATE system_admins SET sso_provider = 'GOOGLE', sso_id = $1, last_active_at = CURRENT_TIMESTAMP WHERE id = $2",
		info.ID, dbUserID)

	expirationTime := time.Now().Add(12 * time.Hour)
	claims := &middleware.CustomClaims{
		UserID: dbUserID,
		Role:   dbRole,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   dbUserID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "drivers-for-u-auth",
		},
	}
	tokenString, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}

	h.recordAuditLog(ctx, dbUserID, info.Email, "SSO_LOGIN_SUCCESS", "Google Workspace SSO authenticated", ip)

	// Hand the token to the SPA via a fragment so it never lands in server logs.
	redirect := fmt.Sprintf("%s/admin/sso-callback#token=%s&role=%s",
		frontendURL(), url.QueryEscape(tokenString), url.QueryEscape(dbRole))
	http.Redirect(w, r, redirect, http.StatusFound)
}

func exchangeGoogleCode(ctx context.Context, clientID, clientSecret, redirectURL, code string) (*googleUserInfo, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("redirect_uri", redirectURL)
	form.Set("grant_type", "authorization_code")

	httpClient := &http.Client{Timeout: 10 * time.Second}

	tokReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	tokReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokResp, err := httpClient.Do(tokReq)
	if err != nil {
		return nil, fmt.Errorf("token request: %w", err)
	}
	defer tokResp.Body.Close()
	if tokResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint status %d", tokResp.StatusCode)
	}
	var tok googleTokenResponse
	if err := json.NewDecoder(tokResp.Body).Decode(&tok); err != nil {
		return nil, fmt.Errorf("decode token: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("empty access token")
	}

	uiReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, googleUserInfoURL, nil)
	uiReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	uiResp, err := httpClient.Do(uiReq)
	if err != nil {
		return nil, fmt.Errorf("userinfo request: %w", err)
	}
	defer uiResp.Body.Close()
	if uiResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo status %d", uiResp.StatusCode)
	}
	var info googleUserInfo
	if err := json.NewDecoder(uiResp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decode userinfo: %w", err)
	}
	return &info, nil
}
