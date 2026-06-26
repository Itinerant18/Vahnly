package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizePhone(t *testing.T) {
	cases := map[string]string{
		"+91 98765 43210": "9876543210",
		"9876543210":      "9876543210",
		"919876543210":    "9876543210",
		"98765-43210":     "9876543210",
		"":                "",
		"abc":             "",
	}
	for in, want := range cases {
		if got := normalizePhone(in); got != want {
			t.Errorf("normalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPhoneBodyKey_RebuffersBody(t *testing.T) {
	body := `{"phone":"+91 98765 43210","otp":"1234"}`
	r := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString(body))
	if key := PhoneBodyKey(r); key != "9876543210" {
		t.Errorf("PhoneBodyKey = %q, want 9876543210", key)
	}
	// The handler must still read the full body after the middleware peeked it.
	rest, _ := io.ReadAll(r.Body)
	if string(rest) != body {
		t.Errorf("body not rebuffered: handler sees %q, want %q", rest, body)
	}
}

func TestPhoneBodyKey_NoPhoneFallsThrough(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString(`{"otp":"1234"}`))
	if key := PhoneBodyKey(r); key != "" {
		t.Errorf("no-phone body should yield empty key (fall through to IP limit), got %q", key)
	}
}

func TestClientIPKey(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/x", nil)
	r.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	if ip := ClientIPKey(r); ip != "203.0.113.7" {
		t.Errorf("XFF first hop: got %q, want 203.0.113.7", ip)
	}
	r2 := httptest.NewRequest(http.MethodPost, "/x", nil)
	r2.RemoteAddr = "198.51.100.9:54321"
	if ip := ClientIPKey(r2); ip != "198.51.100.9" {
		t.Errorf("RemoteAddr host: got %q, want 198.51.100.9", ip)
	}
}
