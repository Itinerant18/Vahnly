package http

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

// Firebase ID-token verification. Phone numbers entered during Google sign-up must be proven
// via Firebase Phone Auth: the client confirms an SMS OTP, then sends the resulting Firebase
// ID token (which carries a verified `phone_number` claim) here. We verify the token against
// Google's securetoken public certs so the phone cannot be forged client-side.

const firebaseCertsURL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"

func firebaseProjectID() string {
	if v := os.Getenv("FIREBASE_PROJECT_ID"); v != "" {
		return v
	}
	return "drivers-for-u-app"
}

type firebaseCertCache struct {
	mu      sync.Mutex
	certs   map[string]*rsa.PublicKey
	expires time.Time
}

var fbCerts = &firebaseCertCache{}

func (c *firebaseCertCache) get(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.certs != nil && time.Now().Before(c.expires) {
		return c.certs, nil
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, firebaseCertsURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("firebase certs status %d", resp.StatusCode)
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
		return nil, fmt.Errorf("no firebase certs parsed")
	}
	c.certs = keys
	c.expires = time.Now().Add(1 * time.Hour) // Google rotates; refresh hourly.
	return keys, nil
}

type firebaseClaims struct {
	PhoneNumber string `json:"phone_number"`
	Email       string `json:"email"`
	jwt.RegisteredClaims
}

// verifyFirebaseToken validates a Firebase ID token (RS256, issuer/audience pinned to the
// project) and returns its claims. The caller trusts phone_number only when err is nil.
func verifyFirebaseToken(ctx context.Context, tokenStr string) (*firebaseClaims, error) {
	projectID := firebaseProjectID()
	keys, err := fbCerts.get(ctx)
	if err != nil {
		return nil, fmt.Errorf("load firebase certs: %w", err)
	}

	claims := &firebaseClaims{}
	_, err = jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		key, ok := keys[kid]
		if !ok {
			return nil, fmt.Errorf("unknown firebase key id")
		}
		return key, nil
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer("https://securetoken.google.com/"+projectID),
		jwt.WithAudience(projectID),
	)
	if err != nil {
		return nil, err
	}
	return claims, nil
}
