package http

import (
	"testing"
	"time"
)

func TestValidateTOTP_AcceptsCurrentCode(t *testing.T) {
	secret := generateTOTPSecret()
	counter := uint64(time.Now().Unix()) / totpPeriod
	code, ok := totpCodeAt(secret, counter)
	if !ok {
		t.Fatalf("failed to derive code from generated secret")
	}
	if !validateTOTP(secret, code) {
		t.Errorf("validateTOTP rejected the current valid code %q", code)
	}
}

func TestValidateTOTP_RejectsWrongAndMalformed(t *testing.T) {
	secret := generateTOTPSecret()
	cases := []string{"", "000", "abcdef", "9999999"}
	for _, c := range cases {
		if validateTOTP(secret, c) {
			t.Errorf("validateTOTP accepted invalid code %q", c)
		}
	}
	// An unprovisioned (empty) secret must never validate.
	if validateTOTP("", "123456") {
		t.Errorf("validateTOTP accepted a code against an empty secret")
	}
}

func TestEnrolmentURI_IsOtpauth(t *testing.T) {
	uri := totpEnrolmentURI("ABCDEFGHIJKLMNOP", "admin@example.com", "Drivers-For-U Admin")
	if uri[:10] != "otpauth://" {
		t.Errorf("enrolment URI not an otpauth URI: %q", uri)
	}
}
