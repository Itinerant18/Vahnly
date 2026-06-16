package objectstore

import (
	"encoding/hex"
	"net/url"
	"strings"
	"testing"
	"time"
)

// TestDeriveSigningKey checks the SigV4 signing-key derivation against AWS's
// published worked example (docs: "Deriving the signing key"). A correct value
// here proves the HMAC chain that every signature depends on.
func TestDeriveSigningKey(t *testing.T) {
	got := hex.EncodeToString(deriveSigningKey(
		"wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam"))
	want := "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
	if got != want {
		t.Fatalf("signing key mismatch:\n got=%s\nwant=%s", got, want)
	}
}

func TestAWSURIEncode(t *testing.T) {
	if got := awsURIEncode("a b/c~d", false); got != "a%20b/c~d" {
		t.Errorf("path encode: got %q", got)
	}
	if got := awsURIEncode("a/b", true); got != "a%2Fb" {
		t.Errorf("query encode (slash): got %q", got)
	}
}

// TestPresignPut verifies a presigned PUT URL is well-formed: virtual-hosted host,
// all required SigV4 query parameters present, and a hex signature appended.
func TestPresignPut(t *testing.T) {
	s := &S3Store{
		bucket: "vahnly-vault", region: "ap-south-1",
		accessKey: "AKIDEXAMPLE", secretKey: "secretkey", enabled: true,
	}
	uploadURL, publicURL, err := s.PresignPut("driver-docs/d1/abc-license.jpg", 15*time.Minute)
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	u, err := url.Parse(uploadURL)
	if err != nil {
		t.Fatalf("bad url: %v", err)
	}
	if u.Host != "vahnly-vault.s3.ap-south-1.amazonaws.com" {
		t.Errorf("unexpected host: %s", u.Host)
	}
	q := u.Query()
	for _, p := range []string{"X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"} {
		if q.Get(p) == "" {
			t.Errorf("missing query param %s", p)
		}
	}
	if q.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" {
		t.Errorf("algorithm: %s", q.Get("X-Amz-Algorithm"))
	}
	if sig := q.Get("X-Amz-Signature"); len(sig) != 64 {
		t.Errorf("signature not 64 hex chars: %q", sig)
	}
	if !strings.HasPrefix(publicURL, "https://vahnly-vault.s3.ap-south-1.amazonaws.com/driver-docs/d1/") {
		t.Errorf("unexpected public url: %s", publicURL)
	}
}

// TestPathStyleEndpoint verifies S3-compatible (MinIO/Supabase) path-style routing.
func TestPathStyleEndpoint(t *testing.T) {
	s := &S3Store{
		bucket: "kyc", region: "ap-south-1",
		accessKey: "k", secretKey: "v", enabled: true,
		endpoint: "http://minio.internal:9000", pathStyle: true,
	}
	_, publicURL, err := s.PresignPut("x/y.pdf", time.Minute)
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	if !strings.HasPrefix(publicURL, "http://minio.internal:9000/kyc/x/y.pdf") {
		t.Errorf("path-style url wrong: %s", publicURL)
	}
}

func TestDisabledStoreErrors(t *testing.T) {
	s := &S3Store{enabled: false}
	if _, _, err := s.PresignPut("k", time.Minute); err == nil {
		t.Error("expected error when store disabled")
	}
}
