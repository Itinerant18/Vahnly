// Package firebaseauth verifies Firebase Auth ID tokens (stdlib + golang-jwt).
//
// Firebase signs ID tokens with Google's securetoken service keys (RS256). This
// package verifies the phone-verification proof minted by Firebase Phone Auth on
// the client — the verified `phone_number` is read from the signed token, never
// from a client-supplied field, so it cannot be spoofed. Shared by the rider and
// driver auth handlers.
package firebaseauth

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const certsURL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"

// ProjectID returns the Firebase project the gateway verifies tokens against.
func ProjectID() string { return os.Getenv("FIREBASE_PROJECT_ID") }

// Claims are the subset of Firebase ID-token claims the gateway trusts.
type Claims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	PhoneNumber   string `json:"phone_number"`
	Name          string `json:"name"`
	jwt.RegisteredClaims
}

var (
	certMu     sync.Mutex
	certs      map[string]*rsa.PublicKey
	certExpiry time.Time
)

// fetchCerts returns Google's current securetoken signing public keys, keyed by
// kid, with a conservative in-process cache so each verification doesn't hit the network.
func fetchCerts(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	certMu.Lock()
	defer certMu.Unlock()
	if certs != nil && time.Now().Before(certExpiry) {
		return certs, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, certsURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("securetoken certs status %d", resp.StatusCode)
	}

	var raw map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	keys := make(map[string]*rsa.PublicKey, len(raw))
	for kid, certPEM := range raw {
		block, _ := pem.Decode([]byte(certPEM))
		if block == nil {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		if pub, ok := cert.PublicKey.(*rsa.PublicKey); ok {
			keys[kid] = pub
		}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("no usable securetoken certs")
	}
	certs = keys
	certExpiry = time.Now().Add(1 * time.Hour)
	return keys, nil
}

// VerifyIDToken verifies a Firebase Auth ID token for projectID and returns its
// claims. It checks the RS256 signature against Google's securetoken certs and
// validates the issuer / audience / expiry per Firebase's documented rules.
func VerifyIDToken(ctx context.Context, idToken, projectID string) (*Claims, error) {
	if projectID == "" {
		return nil, fmt.Errorf("firebase project id not configured")
	}

	claims := &Claims{}
	keyFunc := func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("missing kid")
		}
		c, err := fetchCerts(ctx)
		if err != nil {
			return nil, err
		}
		key, ok := c[kid]
		if !ok {
			return nil, fmt.Errorf("unknown signing key")
		}
		return key, nil
	}

	parsed, err := jwt.ParseWithClaims(idToken, claims, keyFunc,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer("https://securetoken.google.com/"+projectID),
		jwt.WithAudience(projectID),
	)
	if err != nil || !parsed.Valid {
		return nil, fmt.Errorf("invalid firebase token: %w", err)
	}
	return claims, nil
}
