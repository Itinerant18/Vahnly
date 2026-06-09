// Package crypto provides at-rest encryption for individual sensitive column
// values (e.g. driver bank account numbers) that must not be stored in
// plaintext. It uses AES-256-GCM with a key derived from a shared secret.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

// encPrefix marks a value produced by Encrypt so Decrypt can distinguish
// already-encrypted ciphertext from legacy plaintext written before rollout.
const encPrefix = "enc:v1:"

// FieldCipher encrypts and decrypts short field values with AES-256-GCM. The
// provided secret is hashed to a 32-byte key, so any-length secret is accepted;
// the same secret must be supplied to decrypt previously encrypted values.
type FieldCipher struct {
	gcm cipher.AEAD
}

// NewFieldCipher builds a FieldCipher from a non-empty secret string.
func NewFieldCipher(secret string) (*FieldCipher, error) {
	if secret == "" {
		return nil, errors.New("field encryption secret is empty")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &FieldCipher{gcm: gcm}, nil
}

// Encrypt returns a self-describing token: encPrefix + base64(nonce||ciphertext).
func (c *FieldCipher) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt. Values lacking encPrefix are returned unchanged so
// rows written before encryption was enabled remain readable.
func (c *FieldCipher) Decrypt(token string) (string, error) {
	if !strings.HasPrefix(token, encPrefix) {
		return token, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(token, encPrefix))
	if err != nil {
		return "", err
	}
	ns := c.gcm.NonceSize()
	if len(raw) < ns {
		return "", fmt.Errorf("ciphertext too short: %d bytes", len(raw))
	}
	nonce, ct := raw[:ns], raw[ns:]
	plaintext, err := c.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
