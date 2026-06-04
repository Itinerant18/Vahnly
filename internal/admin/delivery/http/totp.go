package http

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// RFC 6238 TOTP, implemented with the standard library only (no external dep).
// Secrets are base32-encoded per the otpauth spec so any authenticator app
// (Google Authenticator, Authy, 1Password) can enrol them.

const (
	totpPeriod = 30
	totpDigits = 6
)

// generateTOTPSecret returns a fresh 160-bit base32 secret (unpadded).
func generateTOTPSecret() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b)
	return strings.TrimRight(base32.StdEncoding.EncodeToString(b), "=")
}

// totpEnrolmentURI builds the otpauth:// URI an authenticator app scans as a QR.
func totpEnrolmentURI(secret, account, issuer string) string {
	label := url.PathEscape(issuer + ":" + account)
	v := url.Values{}
	v.Set("secret", secret)
	v.Set("issuer", issuer)
	v.Set("algorithm", "SHA1")
	v.Set("digits", fmt.Sprintf("%d", totpDigits))
	v.Set("period", fmt.Sprintf("%d", totpPeriod))
	return "otpauth://totp/" + label + "?" + v.Encode()
}

func padBase32(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if m := len(s) % 8; m != 0 {
		s += strings.Repeat("=", 8-m)
	}
	return s
}

func totpCodeAt(secret string, counter uint64) (string, bool) {
	key, err := base32.StdEncoding.DecodeString(padBase32(secret))
	if err != nil || len(key) == 0 {
		return "", false
	}
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])
	return fmt.Sprintf("%0*d", totpDigits, code%1_000_000), true
}

// validateTOTP accepts the current 30s window plus one step either side to
// tolerate clock skew. Comparison is constant-time.
func validateTOTP(secret, code string) bool {
	code = strings.TrimSpace(code)
	if secret == "" || len(code) != totpDigits {
		return false
	}
	counter := int64(time.Now().Unix()) / totpPeriod
	for _, w := range []int64{-1, 0, 1} {
		if c, ok := totpCodeAt(secret, uint64(counter+w)); ok && hmac.Equal([]byte(c), []byte(code)) {
			return true
		}
	}
	return false
}
