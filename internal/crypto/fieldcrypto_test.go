package crypto

import "testing"

func TestFieldCipherRoundTrip(t *testing.T) {
	c, err := NewFieldCipher("test-secret")
	if err != nil {
		t.Fatalf("NewFieldCipher: %v", err)
	}

	plaintext := "1234567890123456"
	enc, err := c.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if enc == plaintext {
		t.Fatal("ciphertext equals plaintext; not encrypted")
	}

	got, err := c.Decrypt(enc)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if got != plaintext {
		t.Fatalf("round trip mismatch: got %q want %q", got, plaintext)
	}
}

func TestFieldCipherNonceIsRandom(t *testing.T) {
	c, _ := NewFieldCipher("test-secret")
	a, _ := c.Encrypt("same")
	b, _ := c.Encrypt("same")
	if a == b {
		t.Fatal("identical ciphertext for repeated plaintext; nonce not random")
	}
}

func TestFieldCipherDecryptLegacyPlaintext(t *testing.T) {
	c, _ := NewFieldCipher("test-secret")
	// Values written before encryption rollout lack the enc prefix and must
	// pass through unchanged.
	got, err := c.Decrypt("legacy-plaintext")
	if err != nil {
		t.Fatalf("Decrypt legacy: %v", err)
	}
	if got != "legacy-plaintext" {
		t.Fatalf("legacy passthrough mismatch: got %q", got)
	}
}

func TestNewFieldCipherEmptySecret(t *testing.T) {
	if _, err := NewFieldCipher(""); err == nil {
		t.Fatal("expected error for empty secret")
	}
}

func TestFieldCipherWrongKeyFails(t *testing.T) {
	a, _ := NewFieldCipher("key-a")
	b, _ := NewFieldCipher("key-b")
	enc, _ := a.Encrypt("secret")
	if _, err := b.Decrypt(enc); err == nil {
		t.Fatal("decrypt with wrong key should fail authentication")
	}
}
