package http

import (
	"context"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// Sign in with Apple via the OAuth2 authorization-code flow. Apple differs from
// Google in two ways the spec requires: (1) the token-endpoint client_secret is a
// short-lived ES256 JWT signed with the team's .p8 key, and (2) the user's email
// comes from the returned id_token (a JWT), which we verify against Apple's JWKS.
// The flow is gated on env vars; unset → 503 so the deployment runs password-only.
// Apple identities reuse the existing system_admins.sso_provider/sso_id columns.

const (
	appleAuthURL  = "https://appleid.apple.com/auth/authorize"
	appleTokenURL = "https://appleid.apple.com/auth/token"
	appleKeysURL  = "https://appleid.apple.com/auth/keys"
	appleIssuer   = "https://appleid.apple.com"
)

func appleSSOConfig() (clientID, teamID, keyID, privateKey, redirectURL string, ok bool) {
	clientID = os.Getenv("APPLE_OAUTH_CLIENT_ID")
	teamID = os.Getenv("APPLE_OAUTH_TEAM_ID")
	keyID = os.Getenv("APPLE_OAUTH_KEY_ID")
	privateKey = os.Getenv("APPLE_OAUTH_PRIVATE_KEY")
	redirectURL = os.Getenv("APPLE_OAUTH_REDIRECT_URL")
	ok = clientID != "" && teamID != "" && keyID != "" && privateKey != "" && redirectURL != ""
	return
}

// HandleSSOAppleStart redirects the browser to Apple's consent screen.
func (h *AdminAuthHandler) HandleSSOAppleStart(w http.ResponseWriter, r *http.Request) {
	clientID, _, _, _, redirectURL, ok := appleSSOConfig()
	if !ok {
		http.Error(w, "sso_not_configured", http.StatusServiceUnavailable)
		return
	}

	state := randomState()
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
	v.Set("scope", "name email")
	v.Set("state", state)
	// Apple requires response_mode=form_post when the email/name scope is requested.
	v.Set("response_mode", "form_post")
	http.Redirect(w, r, appleAuthURL+"?"+v.Encode(), http.StatusFound)
}

// HandleSSOAppleCallback handles Apple's form_post callback: validates state,
// exchanges the code (with an ES256 client_secret), verifies the id_token against
// Apple's JWKS, resolves the admin by verified email, and mints a session.
func (h *AdminAuthHandler) HandleSSOAppleCallback(w http.ResponseWriter, r *http.Request) {
	clientID, teamID, keyID, privateKey, redirectURL, ok := appleSSOConfig()
	if !ok {
		http.Error(w, "sso_not_configured", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	ip := getClientIP(r)

	// Apple POSTs the result as application/x-www-form-urlencoded (form_post mode).
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid_callback_form", http.StatusBadRequest)
		return
	}
	code := r.FormValue("code")
	state := r.FormValue("state")
	if code == "" {
		http.Error(w, "missing_code", http.StatusBadRequest)
		return
	}
	stateCookie, err := r.Cookie("admin_sso_state")
	if err != nil || stateCookie.Value == "" || stateCookie.Value != state {
		http.Error(w, "invalid_state", http.StatusBadRequest)
		return
	}

	clientSecret, err := buildAppleClientSecret(teamID, clientID, keyID, privateKey)
	if err != nil {
		h.recordAuditLog(ctx, "", "", "SSO_FAILURE", "Apple client_secret build failed: "+err.Error(), ip)
		http.Error(w, "sso_misconfigured", http.StatusInternalServerError)
		return
	}

	email, appleSub, err := exchangeAppleCode(ctx, clientID, clientSecret, redirectURL, code)
	if err != nil {
		h.recordAuditLog(ctx, "", "", "SSO_FAILURE", "Apple code exchange failed: "+err.Error(), ip)
		http.Error(w, "sso_exchange_failed", http.StatusUnauthorized)
		return
	}
	if email == "" {
		http.Error(w, "email_not_available", http.StatusUnauthorized)
		return
	}

	// Resolve admin by email. SSO never auto-creates admins.
	var dbUserID, dbRole string
	var dbIsActive bool
	if lookErr := h.dbPool.QueryRow(ctx,
		"SELECT id, role, is_active FROM system_admins WHERE email = $1", email,
	).Scan(&dbUserID, &dbRole, &dbIsActive); lookErr != nil {
		h.recordAuditLog(ctx, "", email, "SSO_FAILURE", "No admin account for Apple SSO email", ip)
		http.Error(w, "sso_account_not_provisioned", http.StatusForbidden)
		return
	}
	if !dbIsActive {
		http.Error(w, "account_suspended", http.StatusForbidden)
		return
	}

	_, _ = h.dbPool.Exec(ctx,
		"UPDATE system_admins SET sso_provider = 'APPLE', sso_id = $1, last_active_at = CURRENT_TIMESTAMP WHERE id = $2",
		appleSub, dbUserID)

	expirationTime := time.Now().Add(12 * time.Hour)
	claims := &middleware.CustomClaims{
		UserID: dbUserID,
		Role:   dbRole,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   dbUserID,
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "vahnly-auth",
		},
	}
	tokenString, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.jwtSecret)
	if err != nil {
		http.Error(w, "internal_server_error", http.StatusInternalServerError)
		return
	}

	middleware.SetSessionCookie(w, tokenString)
	h.recordAuditLog(ctx, dbUserID, email, "SSO_LOGIN_SUCCESS", "Apple SSO authenticated", ip)
	http.Redirect(w, r, frontendURL()+"/admin/sso-callback#role="+url.QueryEscape(dbRole), http.StatusFound)
}

// buildAppleClientSecret signs the short-lived ES256 JWT Apple's token endpoint
// requires in place of a static client secret.
func buildAppleClientSecret(teamID, clientID, keyID, privateKeyPEM string) (string, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return "", fmt.Errorf("invalid apple private key PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parse apple private key: %w", err)
	}
	ecKey, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("apple private key is not ECDSA")
	}
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer:    teamID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
		Audience:  jwt.ClaimStrings{appleIssuer},
		Subject:   clientID,
	})
	tok.Header["kid"] = keyID
	return tok.SignedString(ecKey)
}

type appleTokenResponse struct {
	IDToken string `json:"id_token"`
}

// exchangeAppleCode swaps the auth code for tokens and returns the verified email
// and Apple subject from the id_token (signature-checked against Apple's JWKS).
func exchangeAppleCode(ctx context.Context, clientID, clientSecret, redirectURL, code string) (email, sub string, err error) {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", redirectURL)

	httpClient := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, appleTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("token endpoint status %d", resp.StatusCode)
	}
	var tok appleTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", "", fmt.Errorf("decode token: %w", err)
	}
	if tok.IDToken == "" {
		return "", "", fmt.Errorf("empty id_token")
	}

	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(tok.IDToken, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected id_token alg")
		}
		kid, _ := t.Header["kid"].(string)
		return appleSigningKey(ctx, kid)
	}, jwt.WithIssuer(appleIssuer), jwt.WithAudience(clientID))
	if err != nil {
		return "", "", fmt.Errorf("verify id_token: %w", err)
	}

	if e, _ := claims["email"].(string); e != "" {
		// email_verified may arrive as a bool or the string "true".
		switch v := claims["email_verified"].(type) {
		case bool:
			if v {
				email = e
			}
		case string:
			if v == "true" {
				email = e
			}
		default:
			email = e // Apple omits the flag for verified Apple-domain accounts
		}
	}
	sub, _ = claims["sub"].(string)
	return email, sub, nil
}

// appleSigningKey fetches Apple's JWKS and builds the RSA public key for the kid.
func appleSigningKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, appleKeysURL, nil)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch apple jwks: %w", err)
	}
	defer resp.Body.Close()

	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("decode apple jwks: %w", err)
	}
	for _, k := range jwks.Keys {
		if k.Kid != kid {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return nil, fmt.Errorf("decode jwk modulus: %w", err)
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, fmt.Errorf("decode jwk exponent: %w", err)
		}
		return &rsa.PublicKey{
			N: new(big.Int).SetBytes(nBytes),
			E: int(new(big.Int).SetBytes(eBytes).Int64()),
		}, nil
	}
	return nil, fmt.Errorf("no apple jwk for kid %s", kid)
}
