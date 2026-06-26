package middleware

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// AccessTokenTTL is the access-JWT lifetime, env-overridable via ACCESS_TOKEN_TTL (e.g. "30m", "1h").
// Default is 7d — i.e. UNCHANGED from before refresh tokens, so shipping the refresh plumbing is a
// no-op by default. Once the refresh round-trip is verified on-device, set ACCESS_TOKEN_TTL=30m to
// activate the short-access-token cap (the whole point of Option B). Fully reversible via env.
func AccessTokenTTL() time.Duration {
	if v := os.Getenv("ACCESS_TOKEN_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return 7 * 24 * time.Hour
}

// Refresh tokens (P1): a short-lived access JWT is paired with a long-lived opaque refresh token so
// users are never randomly logged out, while the access token stays short. The refresh token is
// stored ONLY as a sha256 hash in Redis (`refresh:<hash>` → "<role>:<userID>"), so a Redis dump can't
// be replayed as a bearer token. Rotation on every use (GetDel) gives replay detection: a refresh
// token works exactly once; a replayed one finds its key already gone → rejected.

const RefreshTokenTTL = 90 * 24 * time.Hour

var ErrInvalidRefreshToken = errors.New("invalid or expired refresh token")

func refreshKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "refresh:" + hex.EncodeToString(sum[:])
}

// refreshIndexKey is the per-user SET of live refresh-token keys, so "log out all devices" can find
// and delete them all. ponytail: the index may carry a few stale entries (a rotated key whose SREM
// was missed) — deleting a stale key is a harmless no-op, so it never causes a missed revoke.
func refreshIndexKey(role, userID string) string {
	return "refreshidx:" + role + ":" + userID
}

// MintRefreshToken creates an opaque refresh token bound to (role, userID) and stores its hash.
// Returns "" (no error) when Redis is unwired (dev) — callers simply omit the refresh token.
func MintRefreshToken(ctx context.Context, rc *redis.ClusterClient, role, userID string) (string, error) {
	if rc == nil {
		return "", nil
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	key := refreshKey(token)
	if err := rc.Set(ctx, key, role+":"+userID, RefreshTokenTTL).Err(); err != nil {
		return "", err
	}
	idx := refreshIndexKey(role, userID)
	_ = rc.SAdd(ctx, idx, key).Err()
	_ = rc.Expire(ctx, idx, RefreshTokenTTL).Err()
	return token, nil
}

// RevokeAllRefreshTokens deletes every refresh token for a user (used by logout-all + password reset).
// Deletes keys one-by-one because they hash to different cluster slots (a multi-key DEL would fail).
func RevokeAllRefreshTokens(ctx context.Context, rc *redis.ClusterClient, role, userID string) {
	if rc == nil {
		return
	}
	idx := refreshIndexKey(role, userID)
	keys, err := rc.SMembers(ctx, idx).Result()
	if err == nil {
		for _, k := range keys {
			_ = rc.Del(ctx, k).Err()
		}
	}
	_ = rc.Del(ctx, idx).Err()
}

// RotateRefreshToken atomically consumes the presented refresh token (GetDel) and issues a fresh one.
// Returns (role, userID, newRefresh). A missing/replayed/expired token → ErrInvalidRefreshToken.
func RotateRefreshToken(ctx context.Context, rc *redis.ClusterClient, presented string) (role, userID, newToken string, err error) {
	if rc == nil || presented == "" {
		return "", "", "", ErrInvalidRefreshToken
	}
	val, gErr := rc.GetDel(ctx, refreshKey(presented)).Result()
	if gErr != nil || val == "" {
		return "", "", "", ErrInvalidRefreshToken
	}
	parts := strings.SplitN(val, ":", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", "", ErrInvalidRefreshToken
	}
	role, userID = parts[0], parts[1]
	_ = rc.SRem(ctx, refreshIndexKey(role, userID), refreshKey(presented)).Err() // drop the consumed key
	newToken, err = MintRefreshToken(ctx, rc, role, userID)
	if err != nil {
		return "", "", "", err
	}
	return role, userID, newToken, nil
}

// RevokeRefreshToken deletes a single refresh token (logout). Best-effort.
func RevokeRefreshToken(ctx context.Context, rc *redis.ClusterClient, token string) {
	if rc == nil || token == "" {
		return
	}
	_ = rc.Del(ctx, refreshKey(token)).Err()
}
