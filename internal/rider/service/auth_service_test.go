package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/platform/driver-delivery/internal/domain"
)

// ---- fakes ----

type fakeAuthRepo struct {
	ridersByPhone map[string]*domain.Rider
	ridersByID    map[string]*domain.Rider
	session       *domain.RiderOTPSession
	otpCreated    bool
	incremented   int
	marked        bool
	touched       bool
}

func newFakeAuthRepo() *fakeAuthRepo {
	return &fakeAuthRepo{
		ridersByPhone: map[string]*domain.Rider{},
		ridersByID:    map[string]*domain.Rider{},
	}
}

func (f *fakeAuthRepo) GetRiderByPhone(_ context.Context, phone string) (*domain.Rider, error) {
	if r, ok := f.ridersByPhone[phone]; ok {
		return r, nil
	}
	return nil, pgx.ErrNoRows
}

func (f *fakeAuthRepo) GetRiderByID(_ context.Context, id string) (*domain.Rider, error) {
	if r, ok := f.ridersByID[id]; ok {
		return r, nil
	}
	return nil, pgx.ErrNoRows
}

func (f *fakeAuthRepo) CreateRider(_ context.Context, phone string) (*domain.Rider, error) {
	r := &domain.Rider{ID: "rider-" + phone, Phone: phone, PhoneVerified: true, IsActive: true}
	f.ridersByPhone[phone] = r
	f.ridersByID[r.ID] = r
	return r, nil
}

func (f *fakeAuthRepo) TouchLastLogin(_ context.Context, _ string) error {
	f.touched = true
	return nil
}

func (f *fakeAuthRepo) CreateOTPSession(_ context.Context, _, _, _ string, _ time.Duration) error {
	f.otpCreated = true
	return nil
}

func (f *fakeAuthRepo) GetActiveOTPSession(_ context.Context, _, _ string) (*domain.RiderOTPSession, error) {
	if f.session == nil {
		return nil, pgx.ErrNoRows
	}
	return f.session, nil
}

func (f *fakeAuthRepo) IncrementOTPAttempts(_ context.Context, _ string) error {
	f.incremented++
	return nil
}
func (f *fakeAuthRepo) MarkOTPUsed(_ context.Context, _ string) error { f.marked = true; return nil }

type fakeCache struct {
	count    int64
	sessions map[string]string
}

func newFakeCache() *fakeCache { return &fakeCache{sessions: map[string]string{}} }

func (c *fakeCache) IncrementWithTTL(_ context.Context, _ string, _ time.Duration) (int64, error) {
	c.count++
	return c.count, nil
}
func (c *fakeCache) StoreSession(_ context.Context, riderID, jti string, _ time.Duration) error {
	c.sessions[riderID] = jti
	return nil
}
func (c *fakeCache) GetSession(_ context.Context, riderID string) (string, error) {
	return c.sessions[riderID], nil
}

type capturingSMS struct{ sent int }

func (s *capturingSMS) SendSMS(_, _ string) error { s.sent++; return nil }

const testPhone = "+919876543210"

func sessionWithOTP(t *testing.T, otp string) *domain.RiderOTPSession {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash otp: %v", err)
	}
	return &domain.RiderOTPSession{
		ID: "otp-1", Phone: testPhone, OTPHash: string(hash),
		Purpose: otpPurposeLogin, Attempts: 0, MaxAttempts: 5,
		ExpiresAt: time.Now().Add(time.Minute),
	}
}

// ---- SendOTP: rate limiting ----

func TestSendOTP_AllowsUnderLimit(t *testing.T) {
	repo := newFakeAuthRepo()
	cache := newFakeCache()
	sms := &capturingSMS{}
	svc := NewAuthService(repo, cache, sms, "secret")

	if err := svc.SendOTP(context.Background(), testPhone); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if !repo.otpCreated {
		t.Error("expected an OTP session to be created")
	}
	if sms.sent != 1 {
		t.Errorf("expected 1 SMS dispatch, got %d", sms.sent)
	}
}

func TestSendOTP_RateLimited(t *testing.T) {
	repo := newFakeAuthRepo()
	cache := newFakeCache()
	cache.count = otpMaxPerWindow // next Incr -> otpMaxPerWindow+1, over the limit
	svc := NewAuthService(repo, cache, &capturingSMS{}, "secret")

	err := svc.SendOTP(context.Background(), testPhone)
	if !errors.Is(err, ErrOTPRateLimited) {
		t.Fatalf("expected ErrOTPRateLimited, got %v", err)
	}
	if repo.otpCreated {
		t.Error("rate-limited request must not create an OTP session")
	}
}

func TestSendOTP_InvalidPhone(t *testing.T) {
	svc := NewAuthService(newFakeAuthRepo(), newFakeCache(), &capturingSMS{}, "secret")
	if err := svc.SendOTP(context.Background(), "12345"); !errors.Is(err, ErrInvalidPhone) {
		t.Fatalf("expected ErrInvalidPhone, got %v", err)
	}
}

func TestSendOTP_NormalizesBarePhone(t *testing.T) {
	repo := newFakeAuthRepo()
	svc := NewAuthService(repo, newFakeCache(), &capturingSMS{}, "secret")
	// A bare 10-digit number should be normalized to +91 and accepted.
	if err := svc.SendOTP(context.Background(), "9876543210"); err != nil {
		t.Fatalf("expected bare phone to normalize and succeed, got %v", err)
	}
}

// ---- VerifyOTP: bcrypt verify + new-user detection ----

func TestVerifyOTP_NewRiderDetected(t *testing.T) {
	repo := newFakeAuthRepo()
	repo.session = sessionWithOTP(t, "123456")
	svc := NewAuthService(repo, newFakeCache(), &capturingSMS{}, "secret")

	rider, token, err := svc.VerifyOTP(context.Background(), testPhone, "123456")
	if !errors.Is(err, ErrNewRider) {
		t.Fatalf("expected ErrNewRider, got %v", err)
	}
	if rider == nil || rider.Phone != testPhone {
		t.Fatalf("expected a created rider for %s, got %+v", testPhone, rider)
	}
	if token != "" {
		t.Errorf("new rider must get an empty token from VerifyOTP, got %q", token)
	}
	if !repo.marked {
		t.Error("OTP should be marked used on success")
	}
}

func TestVerifyOTP_ExistingRiderGetsToken(t *testing.T) {
	repo := newFakeAuthRepo()
	existing := &domain.Rider{ID: "rider-existing", Phone: testPhone, IsActive: true}
	repo.ridersByPhone[testPhone] = existing
	repo.ridersByID[existing.ID] = existing
	repo.session = sessionWithOTP(t, "654321")
	cache := newFakeCache()
	svc := NewAuthService(repo, cache, &capturingSMS{}, "secret")

	rider, token, err := svc.VerifyOTP(context.Background(), testPhone, "654321")
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if rider.ID != "rider-existing" {
		t.Errorf("expected existing rider, got %+v", rider)
	}
	if token == "" {
		t.Error("existing rider must receive a session token")
	}
	if !repo.touched {
		t.Error("expected last_login to be touched for an existing rider")
	}
	if cache.sessions[existing.ID] == "" {
		t.Error("expected a session jti to be stored in cache")
	}
}

func TestVerifyOTP_WrongOTP(t *testing.T) {
	repo := newFakeAuthRepo()
	repo.session = sessionWithOTP(t, "111111")
	svc := NewAuthService(repo, newFakeCache(), &capturingSMS{}, "secret")

	_, _, err := svc.VerifyOTP(context.Background(), testPhone, "999999")
	if !errors.Is(err, ErrOTPInvalid) {
		t.Fatalf("expected ErrOTPInvalid, got %v", err)
	}
	if repo.incremented != 1 {
		t.Errorf("expected attempts incremented once, got %d", repo.incremented)
	}
	if repo.marked {
		t.Error("OTP must not be marked used on a failed attempt")
	}
}

func TestVerifyOTP_NoActiveSession(t *testing.T) {
	repo := newFakeAuthRepo() // session is nil
	svc := NewAuthService(repo, newFakeCache(), &capturingSMS{}, "secret")
	if _, _, err := svc.VerifyOTP(context.Background(), testPhone, "123456"); !errors.Is(err, ErrOTPNotFound) {
		t.Fatalf("expected ErrOTPNotFound, got %v", err)
	}
}

func TestVerifyOTP_MaxAttemptsExceeded(t *testing.T) {
	repo := newFakeAuthRepo()
	sess := sessionWithOTP(t, "123456")
	sess.Attempts = sess.MaxAttempts
	repo.session = sess
	svc := NewAuthService(repo, newFakeCache(), &capturingSMS{}, "secret")
	if _, _, err := svc.VerifyOTP(context.Background(), testPhone, "123456"); !errors.Is(err, ErrOTPMaxAttempts) {
		t.Fatalf("expected ErrOTPMaxAttempts, got %v", err)
	}
}

// ---- RiderFromJWT round-trip ----

func TestRiderFromJWT_RoundTrip(t *testing.T) {
	repo := newFakeAuthRepo()
	rider := &domain.Rider{ID: "rider-jwt", Phone: testPhone, IsActive: true}
	repo.ridersByID[rider.ID] = rider
	cache := newFakeCache()
	svc := NewAuthService(repo, cache, &capturingSMS{}, "secret")

	token, err := svc.IssueSession(context.Background(), rider)
	if err != nil {
		t.Fatalf("issue session: %v", err)
	}
	got, err := svc.RiderFromJWT(context.Background(), token)
	if err != nil {
		t.Fatalf("expected valid token, got %v", err)
	}
	if got.ID != rider.ID {
		t.Errorf("expected rider %s, got %s", rider.ID, got.ID)
	}

	// A tampered/garbage token must be rejected.
	if _, err := svc.RiderFromJWT(context.Background(), token+"x"); !errors.Is(err, ErrInvalidToken) && !errors.Is(err, ErrSessionInvalid) {
		t.Errorf("expected rejection of tampered token, got %v", err)
	}
}
