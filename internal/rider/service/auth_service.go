package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/platform/driver-delivery/internal/domain"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// Sentinel errors surfaced by the rider auth service. Handlers map these to
// HTTP status codes + stable error codes for the JSON envelope.
var (
	// ErrNewRider signals VerifyOTP created a brand-new rider account. The caller
	// must route the rider into onboarding. The returned token is empty per the
	// service contract; the handler mints a session token separately so a new
	// rider can still reach the protected onboarding endpoints.
	ErrNewRider = errors.New("new rider — onboarding required")

	ErrInvalidPhone   = errors.New("invalid phone number")
	ErrOTPRateLimited = errors.New("otp rate limit exceeded")
	ErrOTPNotFound    = errors.New("no active otp session")
	ErrOTPMaxAttempts = errors.New("otp attempt limit exceeded")
	ErrOTPInvalid     = errors.New("incorrect otp")
	ErrInvalidToken   = errors.New("invalid or expired token")
	ErrSessionInvalid = errors.New("session not found or revoked")
	ErrRiderInactive  = errors.New("rider account is inactive")
)

const (
	otpPurposeLogin  = "LOGIN"
	otpTTL           = 5 * time.Minute
	otpRateWindow    = time.Hour
	otpMaxPerWindow  = 5
	bcryptOTPCost    = 10
	riderSessionTTL  = 72 * time.Hour
	riderTokenIssuer = "drivers-for-u-rider-auth"
)

// indiaPhoneRe matches an E.164 Indian mobile number: +91 followed by a 10-digit
// number whose leading digit is 6-9.
var indiaPhoneRe = regexp.MustCompile(`^\+91[6-9]\d{9}$`)

// AuthRepository is the slice of RiderRepository the auth service needs. The
// concrete postgres repository satisfies it structurally.
type AuthRepository interface {
	GetRiderByPhone(ctx context.Context, phone string) (*domain.Rider, error)
	GetRiderByID(ctx context.Context, id string) (*domain.Rider, error)
	CreateRider(ctx context.Context, phone string) (*domain.Rider, error)
	TouchLastLogin(ctx context.Context, riderID string) error
	CreateOTPSession(ctx context.Context, phone, otpHash, purpose string, ttl time.Duration) error
	GetActiveOTPSession(ctx context.Context, phone, purpose string) (*domain.RiderOTPSession, error)
	IncrementOTPAttempts(ctx context.Context, sessionID string) error
	MarkOTPUsed(ctx context.Context, sessionID string) error
}

// RiderCache abstracts the Redis operations used for OTP rate limiting and
// session tracking, so the service is unit-testable without a live cluster.
type RiderCache interface {
	IncrementWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error)
	StoreSession(ctx context.Context, riderID, jti string, ttl time.Duration) error
	GetSession(ctx context.Context, riderID string) (string, error)
}

// SMSSender delivers the OTP to the rider's handset. The concrete transactional
// SMS integration is intentionally left unimplemented (see LogSMSSender).
type SMSSender interface {
	SendSMS(phone, otp string) error
}

// LogSMSSender is a stub that logs instead of sending. It lets the gateway boot
// without a real SMS provider; swap it for a Twilio/MSG91 client in production.
type LogSMSSender struct {
	Logger interface{ Printf(string, ...any) }
}

func (s LogSMSSender) SendSMS(phone, otp string) error {
	if s.Logger != nil {
		s.Logger.Printf("[RIDER_SMS] OTP for %s is %s", phone, otp)
	}
	return nil
}

type AuthService struct {
	repo      AuthRepository
	cache     RiderCache
	sms       SMSSender
	jwtSecret []byte
}

func NewAuthService(repo AuthRepository, cache RiderCache, sms SMSSender, jwtSecret string) *AuthService {
	return &AuthService{repo: repo, cache: cache, sms: sms, jwtSecret: []byte(jwtSecret)}
}

// normalizePhone trims spaces and prefixes a bare 10-digit Indian number with +91.
func normalizePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if matched, _ := regexp.MatchString(`^[6-9]\d{9}$`, phone); matched {
		return "+91" + phone
	}
	return phone
}

// generateOTP returns a cryptographically-random 6-digit numeric OTP.
func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// SendOTP validates the phone, enforces a per-phone hourly rate limit, generates
// and stores a bcrypt-hashed OTP, and dispatches it via SMS.
func (s *AuthService) SendOTP(ctx context.Context, phone string) error {
	phone = normalizePhone(phone)
	if !indiaPhoneRe.MatchString(phone) {
		return ErrInvalidPhone
	}

	// Rate limit: max otpMaxPerWindow requests per phone per hour. Fail open on a
	// cache error so a transient Redis blip never blocks legitimate logins.
	if s.cache != nil {
		count, err := s.cache.IncrementWithTTL(ctx, "rider:otp:rate:"+phone, otpRateWindow)
		if err == nil && count > otpMaxPerWindow {
			return ErrOTPRateLimited
		}
	}

	otp, err := generateOTP()
	if err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(otp), bcryptOTPCost)
	if err != nil {
		return err
	}
	if err := s.repo.CreateOTPSession(ctx, phone, string(hash), otpPurposeLogin, otpTTL); err != nil {
		return err
	}
	if s.sms != nil {
		_ = s.sms.SendSMS(phone, otp)
	}
	return nil
}

// VerifyOTP checks the supplied OTP against the active session. On success it
// resolves (or creates) the rider. For an existing rider it returns a signed
// session JWT. For a new rider it returns (rider, "", ErrNewRider) — the caller
// routes the rider into onboarding.
func (s *AuthService) VerifyOTP(ctx context.Context, phone, otp string) (*domain.Rider, string, error) {
	phone = normalizePhone(phone)
	if !indiaPhoneRe.MatchString(phone) {
		return nil, "", ErrInvalidPhone
	}

	session, err := s.repo.GetActiveOTPSession(ctx, phone, otpPurposeLogin)
	if err != nil {
		// No row / expired session both surface as "no active otp".
		return nil, "", ErrOTPNotFound
	}
	if session.Attempts >= session.MaxAttempts {
		return nil, "", ErrOTPMaxAttempts
	}
	if err := bcrypt.CompareHashAndPassword([]byte(session.OTPHash), []byte(otp)); err != nil {
		_ = s.repo.IncrementOTPAttempts(ctx, session.ID)
		return nil, "", ErrOTPInvalid
	}
	_ = s.repo.MarkOTPUsed(ctx, session.ID)

	rider, err := s.repo.GetRiderByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			created, cErr := s.repo.CreateRider(ctx, phone)
			if cErr != nil {
				return nil, "", cErr
			}
			return created, "", ErrNewRider
		}
		return nil, "", err
	}

	if !rider.IsActive {
		return nil, "", ErrRiderInactive
	}

	_ = s.repo.TouchLastLogin(ctx, rider.ID)

	token, err := s.IssueSession(ctx, rider)
	if err != nil {
		return nil, "", err
	}
	return rider, token, nil
}

// VerifyPhoneOTP validates an OTP against the active session for a phone WITHOUT resolving or
// creating a rider. It proves the caller controls the number, for flows that must verify a
// phone before attaching it to an account (e.g. Google sign-up, where the phone number is
// safety-critical for this "your car, our driver" service). Consumes the session on success.
func (s *AuthService) VerifyPhoneOTP(ctx context.Context, phone, otp string) error {
	phone = normalizePhone(phone)
	if !indiaPhoneRe.MatchString(phone) {
		return ErrInvalidPhone
	}

	session, err := s.repo.GetActiveOTPSession(ctx, phone, otpPurposeLogin)
	if err != nil {
		return ErrOTPNotFound
	}
	if session.Attempts >= session.MaxAttempts {
		return ErrOTPMaxAttempts
	}
	if err := bcrypt.CompareHashAndPassword([]byte(session.OTPHash), []byte(otp)); err != nil {
		_ = s.repo.IncrementOTPAttempts(ctx, session.ID)
		return ErrOTPInvalid
	}
	_ = s.repo.MarkOTPUsed(ctx, session.ID)
	return nil
}

// IssueSession mints an HS256 rider JWT and records its jti in Redis so the
// session can be validated (and revoked) server-side. Exported so the handler
// can issue a token for a freshly-onboarded new rider too.
func (s *AuthService) IssueSession(ctx context.Context, rider *domain.Rider) (string, error) {
	jti := uuid.NewString()
	now := time.Now()
	expiresAt := now.Add(riderSessionTTL)

	claims := &middleware.CustomClaims{
		UserID: rider.ID,
		Role:   domain.RoleRider,
		// CityScope is resolved from the rider's last-known geolocation. That
		// lookup is not wired yet, so it is left empty (stub).
		CityScope: "",
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   rider.ID,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    riderTokenIssuer,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", err
	}
	if s.cache != nil {
		if err := s.cache.StoreSession(ctx, rider.ID, jti, riderSessionTTL); err != nil {
			return "", err
		}
	}
	return signed, nil
}

// RiderFromJWT validates an HS256 rider token: signature, RIDER role, and that
// the token's jti still matches the active Redis session. Returns the rider.
func (s *AuthService) RiderFromJWT(ctx context.Context, tokenString string) (*domain.Rider, error) {
	claims := &middleware.CustomClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	if !strings.EqualFold(claims.Role, domain.RoleRider) {
		return nil, ErrInvalidToken
	}

	// Session check: the jti must match the value stored at issue time. Fail
	// closed — an unverifiable session is rejected.
	if s.cache != nil {
		jti, err := s.cache.GetSession(ctx, claims.UserID)
		if err != nil || jti == "" || jti != claims.ID {
			return nil, ErrSessionInvalid
		}
	}

	rider, err := s.repo.GetRiderByID(ctx, claims.UserID)
	if err != nil {
		return nil, ErrInvalidToken
	}
	if !rider.IsActive {
		return nil, ErrRiderInactive
	}
	return rider, nil
}

// ---- Redis-backed RiderCache implementation ----

type redisRiderCache struct {
	client *redis.ClusterClient
}

// NewRedisRiderCache adapts a Redis cluster client to the RiderCache interface.
func NewRedisRiderCache(client *redis.ClusterClient) RiderCache {
	return &redisRiderCache{client: client}
}

func (c *redisRiderCache) IncrementWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	n, err := c.client.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	// Set the window expiry only on the first hit so the window is fixed, not sliding.
	if n == 1 {
		_ = c.client.Expire(ctx, key, ttl).Err()
	}
	return n, nil
}

func (c *redisRiderCache) StoreSession(ctx context.Context, riderID, jti string, ttl time.Duration) error {
	return c.client.Set(ctx, "rider:session:"+riderID, jti, ttl).Err()
}

func (c *redisRiderCache) GetSession(ctx context.Context, riderID string) (string, error) {
	val, err := c.client.Get(ctx, "rider:session:"+riderID).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil // no active session — caller treats empty as a miss
	}
	if err != nil {
		return "", err
	}
	return val, nil
}
