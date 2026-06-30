package http

import "testing"

// lastTenDigits underpins format-agnostic login: any entry format for an Indian
// mobile must collapse to the same bare 10-digit key the lookup matches on. If this
// breaks, "registered but NOT_FOUND" logins come back.
func TestLastTenDigits(t *testing.T) {
	cases := map[string]string{
		"9832520886":       "9832520886", // already bare
		"+919832520886":    "9832520886", // E.164
		"919832520886":     "9832520886", // country code, no +
		"09832520886":      "9832520886", // leading trunk 0
		"98325 20886":      "9832520886", // formatted with space
		"+91 98325-20886":  "9832520886", // mixed separators
		"12345":            "12345",      // short (caller rejects <10)
		"":                 "",
	}
	for in, want := range cases {
		if got := lastTenDigits(in); got != want {
			t.Errorf("lastTenDigits(%q) = %q, want %q", in, got, want)
		}
	}
}
