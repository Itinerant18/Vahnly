package http

import "testing"

func TestNormalizePlate(t *testing.T) {
	cases := []struct{ in, want string }{
		{"WB 02 AK 9988", "WB02AK9988"},
		{"wb-02-ak-9988", "WB02AK9988"},
		{"WB02AK9988", "WB02AK9988"},
		{"  wb 02 ak 9988  ", "WB02AK9988"},
		{"", ""},
		{"!!!", ""},
	}
	for _, c := range cases {
		if got := normalizePlate(c.in); got != c.want {
			t.Errorf("normalizePlate(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
