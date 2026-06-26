package http

import "testing"

func TestValidatePasswordPolicy(t *testing.T) {
	cases := []struct {
		pwd string
		ok  bool
	}{
		{"password1", true},   // letters + a digit
		{"abcd1234", true},    // mixed, 8 chars
		{"Abc!2xyz", true},    // 8 chars with symbol
		{"short1", false},     // < 8
		{"1234567", false},    // < 8
		{"12345678", false},   // all numeric
		{"0000000000", false}, // all numeric (looks like a phone)
		{"", false},           // empty
	}
	for _, c := range cases {
		err := validatePasswordPolicy(c.pwd)
		if (err == nil) != c.ok {
			t.Errorf("validatePasswordPolicy(%q): ok=%v, want %v (err=%v)", c.pwd, err == nil, c.ok, err)
		}
	}
}
