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

// Firebase Auth ID-token verification (stdlib + golang-jwt). Firebase signs ID tokens with
// Google's securetoken service keys (RS256). We use this to verify the phone-verification
// proof minted by Firebase Phone Auth on the client — the verified `phone_number` is read
// from the signed token, never from a client-supplied field, so it cannot be spoofed.

const firebaseCertsURL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"

func firebaseProjectID() string { return os.Getenv("FIREBASE_PROJECT_ID") }

type firebaseTokenClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	PhoneNumber   string `json:"phone_number"`
	Name          string `json:"name"`
	jwt.RegisteredClaims
}

var (
	fbCertMu     sync.Mutex
	fbCerts      map[string]*rsa.PublicKey
	fbCertExpiry time.Time
)

// fetchFirebaseCerts returns Google's current securetoken signing public keys, keyed by kid,
// with a conservative in-process cache so each verification doesn't hit the network.
func fetchFirebaseCerts(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	fbCertMu.Lock()
	defer fbCertMu.Unlock()
	if fbCerts != nil && time.Now().Before(fbCertExpiry) {
		return fbCerts, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, firebaseCertsURL, nil)
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
	fbCerts = keys
	fbCertExpiry = time.Now().Add(1 * time.Hour)
	return keys, nil
}

// verifyFirebaseIDToken verifies a Firebase Auth ID token for projectID and returns its
// claims. It checks the RS256 signature against Google's securetoken certs and validates the
// issuer / audience / expiry per Firebase's documented rules.
func verifyFirebaseIDToken(ctx context.Context, idToken, projectID string) (*firebaseTokenClaims, error) {
	if projectID == "" {
		return nil, fmt.Errorf("firebase project id not configured")
	}

	claims := &firebaseTokenClaims{}
	keyFunc := func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("missing kid")
		}
		certs, err := fetchFirebaseCerts(ctx)
		if err != nil {
			return nil, err
		}
		key, ok := certs[kid]
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
