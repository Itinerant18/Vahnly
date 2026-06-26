package domain

import (
	"encoding/json"
	"time"
)

// RoleRider is the JWT role claim carried by rider (car-owner) access tokens.
// It is distinct from the DRIVER and admin roles so the rider auth middleware
// can reject driver/admin tokens outright.
const RoleRider = "RIDER"

// Rider mirrors the riders table (migration 000074).
type Rider struct {
	ID                string     `json:"id"`
	Phone             string     `json:"phone"`
	PhoneVerified     bool       `json:"phone_verified"`
	Name              *string    `json:"name,omitempty"`
	Email             *string    `json:"email,omitempty"`
	EmailVerified     bool       `json:"email_verified"`
	Gender            *string    `json:"gender,omitempty"`
	DateOfBirth       *time.Time `json:"date_of_birth,omitempty"`
	ProfilePhotoURL   *string    `json:"profile_photo_url,omitempty"`
	PreferredLanguage string     `json:"preferred_language"`
	KYCLevel          string     `json:"kyc_level"`
	IsActive          bool       `json:"is_active"`
	PasswordHash      *string    `json:"-"` // bcrypt; nil for OTP-only riders. Never serialized.
	LastLoginAt       *time.Time `json:"last_login_at,omitempty"`
	ReferralCode      *string    `json:"referral_code,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// ReferralReward is the result of crediting a referral after the referred rider's
// first completed trip.
type ReferralReward struct {
	Rewarded            bool   `json:"rewarded"`
	ReferrerRiderID     string `json:"referrer_rider_id"`
	ReferredRiderID     string `json:"referred_rider_id"`
	ReferrerCreditPaise int64  `json:"referrer_credit_paise"`
	ReferredCreditPaise int64  `json:"referred_credit_paise"`
}

// RiderOTPSession mirrors the rider_otp_sessions table (migration 000075).
type RiderOTPSession struct {
	ID          string     `json:"id"`
	Phone       string     `json:"phone"`
	OTPHash     string     `json:"-"`
	Purpose     string     `json:"purpose"`
	Attempts    int        `json:"attempts"`
	MaxAttempts int        `json:"max_attempts"`
	ExpiresAt   time.Time  `json:"expires_at"`
	UsedAt      *time.Time `json:"used_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// RiderGarageCar mirrors the rider_garage table (migration 000076).
type RiderGarageCar struct {
	ID                   string     `json:"id"`
	RiderID              string     `json:"rider_id"`
	Make                 string     `json:"make"`
	Model                string     `json:"model"`
	Year                 int        `json:"year"`
	CarType              string     `json:"car_type"`
	Transmission         string     `json:"transmission"`
	FuelType             *string    `json:"fuel_type,omitempty"`
	RegistrationPlate    string     `json:"registration_plate"`
	Color                *string    `json:"color,omitempty"`
	InsuranceExpiry      *time.Time `json:"insurance_expiry,omitempty"`
	RCDocumentURL        *string    `json:"rc_document_url,omitempty"`
	InsuranceDocumentURL *string    `json:"insurance_document_url,omitempty"`
	PUCDocumentURL       *string    `json:"puc_document_url,omitempty"`
	PUCExpiry            *time.Time `json:"puc_expiry,omitempty"`
	IsDefault            bool       `json:"is_default"`
	IsActive             bool       `json:"is_active"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// RiderSavedPlace mirrors the rider_saved_places table (migration 000077).
// The PostGIS Point column is exposed to callers as separate lat/lng floats.
type RiderSavedPlace struct {
	ID          string    `json:"id"`
	RiderID     string    `json:"rider_id"`
	Label       string    `json:"label"`
	DisplayName string    `json:"display_name"`
	AddressText string    `json:"address_text"`
	Lat         float64   `json:"lat"`
	Lng         float64   `json:"lng"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

// RiderEmergencyContact mirrors the rider_emergency_contacts table (migration 000078).
type RiderEmergencyContact struct {
	ID            string    `json:"id"`
	RiderID       string    `json:"rider_id"`
	Name          string    `json:"name"`
	Phone         string    `json:"phone"`
	Relationship  *string   `json:"relationship,omitempty"`
	AutoShareTrip bool      `json:"auto_share_trip"`
	DisplayOrder  int       `json:"display_order"`
	CreatedAt     time.Time `json:"created_at"`
}

// RiderWallet mirrors the rider_wallet table (migration 000079).
type RiderWallet struct {
	ID           string    `json:"id"`
	RiderID      string    `json:"rider_id"`
	BalancePaise int64     `json:"balance_paise"`
	LockedPaise  int64     `json:"locked_paise"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// RiderWalletTransaction mirrors the rider_wallet_transactions table (migration 000080).
type RiderWalletTransaction struct {
	ID                string    `json:"id"`
	RiderID           string    `json:"rider_id"`
	Type              string    `json:"type"`
	AmountPaise       int64     `json:"amount_paise"`
	BalanceAfterPaise int64     `json:"balance_after_paise"`
	ReferenceID       *string   `json:"reference_id,omitempty"`
	ReferenceType     *string   `json:"reference_type,omitempty"`
	Description       *string   `json:"description,omitempty"`
	IdempotencyKey    *string   `json:"idempotency_key,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

// RiderSavedPaymentMethod mirrors the rider_saved_payment_methods table (migration 000081).
type RiderSavedPaymentMethod struct {
	ID            string    `json:"id"`
	RiderID       string    `json:"rider_id"`
	MethodType    string    `json:"method_type"`
	Provider      *string   `json:"provider,omitempty"`
	ProviderToken string    `json:"-"` // encrypted token, never serialized to clients
	DisplayLabel  *string   `json:"display_label,omitempty"`
	IsDefault     bool      `json:"is_default"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
}

// RiderReferral mirrors the rider_referrals table (migration 000082).
type RiderReferral struct {
	ID                string     `json:"id"`
	ReferrerRiderID   *string    `json:"referrer_rider_id,omitempty"`
	ReferredRiderID   *string    `json:"referred_rider_id,omitempty"`
	ReferralCode      string     `json:"referral_code"`
	Status            string     `json:"status"`
	RewardAmountPaise int64      `json:"reward_amount_paise"`
	RewardedAt        *time.Time `json:"rewarded_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// RiderNotification mirrors the rider_notifications table (migration 000084).
type RiderNotification struct {
	ID        string          `json:"id"`
	RiderID   string          `json:"rider_id"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Data      json.RawMessage `json:"data,omitempty"`
	IsRead    bool            `json:"is_read"`
	CreatedAt time.Time       `json:"created_at"`
}
