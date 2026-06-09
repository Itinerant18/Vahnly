// Package objectstore implements a minimal, dependency-free S3-compatible client
// using AWS Signature Version 4. It supports presigned PUT URLs (for direct
// browser/app uploads that bypass gateway bandwidth) and server-side PutObject.
//
// It targets AWS S3 by default (virtual-hosted style) and any S3-compatible
// service (MinIO, Supabase Storage) via S3_ENDPOINT (path style). No AWS SDK
// dependency — the SigV4 signing is stdlib crypto, so it builds and unit-tests
// fully offline.
package objectstore

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// S3Store holds the connection + credential config for an S3-compatible bucket.
type S3Store struct {
	bucket     string
	region     string
	accessKey  string
	secretKey  string
	endpoint   string // optional; set for S3-compatible services (MinIO/Supabase)
	pathStyle  bool
	enabled    bool
	httpClient *http.Client
}

// NewFromEnv builds an S3Store from the environment. It is Enabled() only when a
// bucket and both credentials are present, so an unconfigured deployment cleanly
// falls back to the legacy local-disk path rather than failing.
//
//	S3_BUCKET, S3_REGION (default ap-south-1 / Mumbai), AWS_ACCESS_KEY_ID,
//	AWS_SECRET_ACCESS_KEY, S3_ENDPOINT (optional), S3_FORCE_PATH_STYLE ("true").
func NewFromEnv() *S3Store {
	s := &S3Store{
		bucket:     os.Getenv("S3_BUCKET"),
		region:     os.Getenv("S3_REGION"),
		accessKey:  os.Getenv("AWS_ACCESS_KEY_ID"),
		secretKey:  os.Getenv("AWS_SECRET_ACCESS_KEY"),
		endpoint:   strings.TrimRight(os.Getenv("S3_ENDPOINT"), "/"),
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
	if s.region == "" {
		s.region = "ap-south-1"
	}
	s.pathStyle = s.endpoint != "" || os.Getenv("S3_FORCE_PATH_STYLE") == "true"
	s.enabled = s.bucket != "" && s.accessKey != "" && s.secretKey != ""
	return s
}

// Enabled reports whether the store is configured for real uploads.
func (s *S3Store) Enabled() bool { return s.enabled }

// Bucket / Region expose config for startup logging.
func (s *S3Store) Bucket() string { return s.bucket }
func (s *S3Store) Region() string { return s.region }

// base resolves scheme, host, and an optional base path for the target service.
func (s *S3Store) base() (scheme, host, basePath string) {
	if s.endpoint != "" {
		if u, err := url.Parse(s.endpoint); err == nil && u.Host != "" {
			return u.Scheme, u.Host, strings.TrimRight(u.Path, "/")
		}
	}
	return "https", fmt.Sprintf("%s.s3.%s.amazonaws.com", s.bucket, s.region), ""
}

// canonicalURI builds the SigV4 canonical (URI-encoded, slash-preserving) path.
func (s *S3Store) canonicalURI(basePath, key string) string {
	key = strings.TrimLeft(key, "/")
	var p string
	if s.pathStyle {
		p = basePath + "/" + s.bucket + "/" + key
	} else {
		p = basePath + "/" + key
	}
	return awsURIEncode(p, false) // preserve "/" in the path
}

// PresignPut returns a presigned URL the client can PUT the object to directly,
// plus the canonical object URL to persist as the document reference.
func (s *S3Store) PresignPut(key string, expiry time.Duration) (uploadURL, publicURL string, err error) {
	if !s.enabled {
		return "", "", fmt.Errorf("object store not configured")
	}
	scheme, host, basePath := s.base()
	canonicalURI := s.canonicalURI(basePath, key)

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := dateStamp + "/" + s.region + "/s3/aws4_request"

	canonicalQuery := buildCanonicalQuery([][2]string{
		{"X-Amz-Algorithm", "AWS4-HMAC-SHA256"},
		{"X-Amz-Credential", s.accessKey + "/" + scope},
		{"X-Amz-Date", amzDate},
		{"X-Amz-Expires", strconv.Itoa(int(expiry.Seconds()))},
		{"X-Amz-SignedHeaders", "host"},
	})

	canonicalHeaders := "host:" + host + "\n"
	signedHeaders := "host"
	canonicalRequest := strings.Join([]string{
		http.MethodPut, canonicalURI, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD",
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := deriveSigningKey(s.secretKey, dateStamp, s.region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))

	uploadURL = scheme + "://" + host + canonicalURI + "?" + canonicalQuery + "&X-Amz-Signature=" + signature
	publicURL = scheme + "://" + host + canonicalURI
	return uploadURL, publicURL, nil
}

// PutObject uploads bytes server-side with a SigV4 header-signed PUT and returns
// the canonical object URL. Used by the multipart streaming upload path.
func (s *S3Store) PutObject(ctx context.Context, key string, body []byte, contentType string) (publicURL string, err error) {
	if !s.enabled {
		return "", fmt.Errorf("object store not configured")
	}
	scheme, host, basePath := s.base()
	canonicalURI := s.canonicalURI(basePath, key)

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := dateStamp + "/" + s.region + "/s3/aws4_request"
	payloadHash := sha256Hex(body)

	canonicalHeaders := "host:" + host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := strings.Join([]string{
		http.MethodPut, canonicalURI, "", canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := deriveSigningKey(s.secretKey, dateStamp, s.region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	authorization := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.accessKey, scope, signedHeaders, signature)

	endpoint := scheme + "://" + host + canonicalURI
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("Authorization", authorization)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return "", fmt.Errorf("s3 put failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return endpoint, nil
}

// --- SigV4 primitives ---

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func deriveSigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}

func buildCanonicalQuery(params [][2]string) string {
	encoded := make([]string, 0, len(params))
	for _, kv := range params {
		encoded = append(encoded, awsURIEncode(kv[0], true)+"="+awsURIEncode(kv[1], true))
	}
	sort.Strings(encoded)
	return strings.Join(encoded, "&")
}

// awsURIEncode implements RFC 3986 encoding per the AWS SigV4 spec: unreserved
// characters pass through, everything else is percent-encoded. "/" is encoded
// only when encodeSlash is true (query values yes, path segments no).
func awsURIEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		case c == '/':
			if encodeSlash {
				b.WriteString("%2F")
			} else {
				b.WriteByte('/')
			}
		default:
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}
