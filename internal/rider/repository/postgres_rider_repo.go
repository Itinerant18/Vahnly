package repository

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/platform/driver-delivery/internal/domain"
)

const referralAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// generateReferralCode returns a DFU-prefixed 8-char code (e.g. DFUAB12K).
func generateReferralCode() string {
	b := make([]byte, 5)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(referralAlphabet))))
		if err != nil {
			b[i] = referralAlphabet[0]
			continue
		}
		b[i] = referralAlphabet[n.Int64()]
	}
	return "DFU" + string(b)
}

// RiderRepository is the persistence contract for the rider (car-owner) domain.
// The concrete implementation is backed by the shared PostgreSQL pool.
type RiderRepository interface {
	CreateRider(ctx context.Context, phone string) (*domain.Rider, error)
	GetRiderByPhone(ctx context.Context, phone string) (*domain.Rider, error)
	GetRiderByID(ctx context.Context, id string) (*domain.Rider, error)
	UpdateRider(ctx context.Context, rider *domain.Rider) (*domain.Rider, error)
	TouchLastLogin(ctx context.Context, riderID string) error
	GetRiderByEmail(ctx context.Context, email string) (*domain.Rider, error)
	CreateRiderWithEmail(ctx context.Context, phone, email, name string) (*domain.Rider, error)

	// ExportRiderData returns the rider's personal data across the rider domain as a
	// portable JSON-serializable map (DPDP data-portability right).
	ExportRiderData(ctx context.Context, riderID string) (map[string]any, error)
	// SoftDeleteRiderAccount scrubs the rider's direct identifiers and purges
	// pure-PII tables while retaining financial/audit rows (DPDP erasure right).
	SoftDeleteRiderAccount(ctx context.Context, riderID string) error

	CreateOTPSession(ctx context.Context, phone, otpHash, purpose string, ttl time.Duration) error
	GetActiveOTPSession(ctx context.Context, phone, purpose string) (*domain.RiderOTPSession, error)
	IncrementOTPAttempts(ctx context.Context, sessionID string) error
	MarkOTPUsed(ctx context.Context, sessionID string) error

	UpsertGarageCar(ctx context.Context, car *domain.RiderGarageCar) (*domain.RiderGarageCar, error)
	GetGarageCars(ctx context.Context, riderID string) ([]*domain.RiderGarageCar, error)
	DeleteGarageCar(ctx context.Context, carID, riderID string) error
	SetDefaultCar(ctx context.Context, carID, riderID string) error

	UpsertSavedPlace(ctx context.Context, place *domain.RiderSavedPlace) (*domain.RiderSavedPlace, error)
	GetSavedPlaces(ctx context.Context, riderID string) ([]*domain.RiderSavedPlace, error)
	DeleteSavedPlace(ctx context.Context, placeID, riderID string) error
	DeleteSavedPlaceByLabel(ctx context.Context, riderID, label string) error

	GetEmergencyContacts(ctx context.Context, riderID string) ([]*domain.RiderEmergencyContact, error)
	UpsertEmergencyContact(ctx context.Context, contact *domain.RiderEmergencyContact) error
	DeleteEmergencyContact(ctx context.Context, contactID, riderID string) error

	GetOrCreateWallet(ctx context.Context, riderID string) (*domain.RiderWallet, error)
	GetWalletTransactions(ctx context.Context, riderID string, limit, offset int) ([]*domain.RiderWalletTransaction, int64, error)

	SaveDeviceToken(ctx context.Context, riderID, token, platform string) error
	GetActiveDeviceTokens(ctx context.Context, riderID string) ([]string, error)
	DeactivateDeviceToken(ctx context.Context, riderID, token string) error

	GetReferralByCode(ctx context.Context, code string) (*domain.RiderReferral, error)
	GetRiderReferrals(ctx context.Context, riderID string) ([]*domain.RiderReferral, error)

	GetNotifications(ctx context.Context, riderID string, limit, offset int) ([]*domain.RiderNotification, error)
	MarkNotificationRead(ctx context.Context, notificationID, riderID string) error
}

type postgresRiderRepo struct {
	dbPool *pgxpool.Pool
}

// NewPostgresRiderRepository returns a RiderRepository backed by PostgreSQL.
func NewPostgresRiderRepository(db *pgxpool.Pool) *postgresRiderRepo {
	return &postgresRiderRepo{dbPool: db}
}

// rowScanner is satisfied by both pgx.Row (QueryRow) and pgx.Rows, so a single
// scan helper can serve point reads and list iteration.
type rowScanner interface {
	Scan(dest ...any) error
}

const riderColumns = `id, phone, phone_verified, name, email, email_verified, gender,
	date_of_birth, profile_photo_url, preferred_language, kyc_level, is_active,
	last_login_at, referral_code, created_at, updated_at`

func scanRider(row rowScanner) (*domain.Rider, error) {
	var r domain.Rider
	err := row.Scan(
		&r.ID, &r.Phone, &r.PhoneVerified, &r.Name, &r.Email, &r.EmailVerified, &r.Gender,
		&r.DateOfBirth, &r.ProfilePhotoURL, &r.PreferredLanguage, &r.KYCLevel, &r.IsActive,
		&r.LastLoginAt, &r.ReferralCode, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ExportRiderData assembles the rider's personal data across the rider domain by
// reusing the existing point-read queries, so the export stays in sync with the
// schema without duplicating SQL.
func (p *postgresRiderRepo) ExportRiderData(ctx context.Context, riderID string) (map[string]any, error) {
	rider, err := p.GetRiderByID(ctx, riderID)
	if err != nil {
		return nil, err
	}
	cars, err := p.GetGarageCars(ctx, riderID)
	if err != nil {
		return nil, err
	}
	places, err := p.GetSavedPlaces(ctx, riderID)
	if err != nil {
		return nil, err
	}
	contacts, err := p.GetEmergencyContacts(ctx, riderID)
	if err != nil {
		return nil, err
	}
	wallet, err := p.GetOrCreateWallet(ctx, riderID)
	if err != nil {
		return nil, err
	}
	txns, _, err := p.GetWalletTransactions(ctx, riderID, 100, 0)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"profile":             rider,
		"garage":              cars,
		"saved_places":        places,
		"emergency_contacts":  contacts,
		"wallet":              wallet,
		"wallet_transactions": txns,
		"exported_at":         time.Now().UTC(),
	}, nil
}

// SoftDeleteRiderAccount anonymizes the retained rider row and purges pure-PII /
// preference tables in a single transaction. Financial & audit rows (wallet,
// wallet_transactions, promo_redemptions, insurance_claims, referrals, orders) are
// intentionally retained for the statutory window and reference the scrubbed row.
func (p *postgresRiderRepo) SoftDeleteRiderAccount(ctx context.Context, riderID string) error {
	tx, err := p.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Capture the original phone first: rider_otp_sessions is keyed by phone, and we
	// are about to overwrite the phone with a tombstone. ErrNoRows => already deleted.
	var phone string
	if err := tx.QueryRow(ctx,
		`SELECT phone FROM riders WHERE id = $1 AND deleted_at IS NULL`, riderID).Scan(&phone); err != nil {
		return err
	}

	for _, q := range []string{
		`DELETE FROM rider_saved_places          WHERE rider_id = $1`,
		`DELETE FROM rider_emergency_contacts    WHERE rider_id = $1`,
		`DELETE FROM rider_saved_payment_methods WHERE rider_id = $1`,
		`DELETE FROM rider_device_tokens         WHERE rider_id = $1`,
		`DELETE FROM rider_garage                WHERE rider_id = $1`,
		`DELETE FROM rider_notifications         WHERE rider_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, riderID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM rider_otp_sessions WHERE phone = $1`, phone); err != nil {
		return err
	}

	// Scrub direct identifiers on the retained row. phone is NOT NULL + UNIQUE, so it
	// gets a deterministic tombstone derived from the PK (fits VARCHAR(15): 'DEL_'+11).
	if _, err := tx.Exec(ctx, `
		UPDATE riders SET
			name              = NULL,
			email             = NULL,
			gender            = NULL,
			date_of_birth     = NULL,
			profile_photo_url = NULL,
			phone             = 'DEL_' || left(replace(id::text, '-', ''), 11),
			phone_verified    = false,
			email_verified    = false,
			is_active         = false,
			deleted_at        = now(),
			updated_at        = now()
		WHERE id = $1 AND deleted_at IS NULL`, riderID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (p *postgresRiderRepo) CreateRider(ctx context.Context, phone string) (*domain.Rider, error) {
	// New riders authenticate via verified OTP, so phone_verified is set true on
	// creation. Each rider gets a unique referral code (retry on the rare collision).
	q := `INSERT INTO riders (phone, phone_verified, referral_code) VALUES ($1, true, $2) RETURNING ` + riderColumns
	var lastErr error
	for i := 0; i < 5; i++ {
		r, err := scanRider(p.dbPool.QueryRow(ctx, q, phone, generateReferralCode()))
		if err == nil {
			return r, nil
		}
		lastErr = err
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && strings.Contains(pgErr.ConstraintName, "referral_code") {
			continue // referral-code collision only — retry with a fresh code
		}
		return nil, err // phone duplicate / other error: do not retry
	}
	return nil, lastErr
}

func (p *postgresRiderRepo) CreateRiderWithEmail(ctx context.Context, phone, email, name string) (*domain.Rider, error) {
	// For Google login users, phone and email are verified automatically.
	q := `INSERT INTO riders (phone, phone_verified, email, email_verified, name, referral_code) VALUES ($1, true, $2, true, $3, $4) RETURNING ` + riderColumns
	var lastErr error
	for i := 0; i < 5; i++ {
		r, err := scanRider(p.dbPool.QueryRow(ctx, q, phone, email, name, generateReferralCode()))
		if err == nil {
			return r, nil
		}
		lastErr = err
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && strings.Contains(pgErr.ConstraintName, "referral_code") {
			continue // referral-code collision only — retry with a fresh code
		}
		return nil, err // phone/email duplicate / other error: do not retry
	}
	return nil, lastErr
}

// GetRiderIDByReferralCode resolves a referrer by their referral code.
func (p *postgresRiderRepo) GetRiderIDByReferralCode(ctx context.Context, code string) (string, error) {
	var id string
	err := p.dbPool.QueryRow(ctx, `SELECT id::text FROM riders WHERE referral_code = $1`, strings.ToUpper(strings.TrimSpace(code))).Scan(&id)
	return id, err
}

// CreatePendingReferral records a PENDING referral. The UNIQUE(referred_rider_id)
// constraint guarantees a rider can only be referred once.
func (p *postgresRiderRepo) CreatePendingReferral(ctx context.Context, referrerID, referredID, code string) error {
	_, err := p.dbPool.Exec(ctx, `
		INSERT INTO rider_referrals (referrer_rider_id, referred_rider_id, referral_code, status)
		VALUES ($1::uuid, $2::uuid, $3, 'PENDING')
		ON CONFLICT (referred_rider_id) DO NOTHING`,
		referrerID, referredID, strings.ToUpper(strings.TrimSpace(code)))
	return err
}

// RewardReferral credits both parties after the referred rider's first completed
// trip and marks the referral REWARDED — all in one transaction (rule #2). It is
// idempotent: a referral already REWARDED yields Rewarded=false.
func (p *postgresRiderRepo) RewardReferral(ctx context.Context, referredRiderID string) (*domain.ReferralReward, error) {
	const referrerCreditPaise int64 = 10000 // ₹100
	const referredCreditPaise int64 = 5000  // ₹50

	tx, err := p.dbPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var referralID, referrerID string
	err = tx.QueryRow(ctx, `
		SELECT id::text, referrer_rider_id::text FROM rider_referrals
		WHERE referred_rider_id = $1::uuid AND status <> 'REWARDED'
		FOR UPDATE`, referredRiderID).Scan(&referralID, &referrerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &domain.ReferralReward{Rewarded: false}, nil // no eligible referral
	}
	if err != nil {
		return nil, err
	}

	if err := creditWalletTx(ctx, tx, referrerID, referrerCreditPaise, referralID, "Referral bonus (referrer)"); err != nil {
		return nil, err
	}
	if err := creditWalletTx(ctx, tx, referredRiderID, referredCreditPaise, referralID, "Referral bonus (referred)"); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE rider_referrals SET status = 'REWARDED', reward_amount_paise = $2, rewarded_at = now()
		WHERE id = $1::uuid`, referralID, referrerCreditPaise+referredCreditPaise); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &domain.ReferralReward{
		Rewarded:            true,
		ReferrerRiderID:     referrerID,
		ReferredRiderID:     referredRiderID,
		ReferrerCreditPaise: referrerCreditPaise,
		ReferredCreditPaise: referredCreditPaise,
	}, nil
}

// creditWalletTx credits a rider wallet and writes the matching ledger row inside
// the caller's transaction (rule #2).
func creditWalletTx(ctx context.Context, tx pgx.Tx, riderID string, amount int64, refID, desc string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO rider_wallet (rider_id) VALUES ($1::uuid) ON CONFLICT (rider_id) DO NOTHING`, riderID); err != nil {
		return err
	}
	var balanceAfter int64
	if err := tx.QueryRow(ctx, `
		UPDATE rider_wallet SET balance_paise = balance_paise + $2, updated_at = now()
		WHERE rider_id = $1::uuid RETURNING balance_paise`, riderID, amount).Scan(&balanceAfter); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO rider_wallet_transactions (rider_id, type, amount_paise, balance_after_paise, reference_id, reference_type, description)
		VALUES ($1::uuid, 'REFERRAL_CREDIT', $2, $3, $4::uuid, 'REFERRAL', $5)`,
		riderID, amount, balanceAfter, refID, desc)
	return err
}

func (p *postgresRiderRepo) GetRiderByPhone(ctx context.Context, phone string) (*domain.Rider, error) {
	q := `SELECT ` + riderColumns + ` FROM riders WHERE phone = $1`
	return scanRider(p.dbPool.QueryRow(ctx, q, phone))
}

func (p *postgresRiderRepo) GetRiderByEmail(ctx context.Context, email string) (*domain.Rider, error) {
	q := `SELECT ` + riderColumns + ` FROM riders WHERE email = $1`
	return scanRider(p.dbPool.QueryRow(ctx, q, email))
}

func (p *postgresRiderRepo) GetRiderByID(ctx context.Context, id string) (*domain.Rider, error) {
	q := `SELECT ` + riderColumns + ` FROM riders WHERE id = $1::uuid`
	return scanRider(p.dbPool.QueryRow(ctx, q, id))
}

func (p *postgresRiderRepo) UpdateRider(ctx context.Context, rider *domain.Rider) (*domain.Rider, error) {
	q := `
		UPDATE riders SET
			name = $2,
			email = $3,
			gender = $4,
			date_of_birth = $5,
			profile_photo_url = $6,
			preferred_language = $7,
			kyc_level = $8,
			is_active = $9,
			phone_verified = $10,
			email_verified = $11,
			updated_at = now()
		WHERE id = $1::uuid
		RETURNING ` + riderColumns
	return scanRider(p.dbPool.QueryRow(ctx, q, rider.ID, rider.Name, rider.Email, rider.Gender,
		rider.DateOfBirth, rider.ProfilePhotoURL, rider.PreferredLanguage, rider.KYCLevel,
		rider.IsActive, rider.PhoneVerified, rider.EmailVerified))
}

func (p *postgresRiderRepo) TouchLastLogin(ctx context.Context, riderID string) error {
	_, err := p.dbPool.Exec(ctx, `UPDATE riders SET last_login_at = now(), updated_at = now() WHERE id = $1::uuid`, riderID)
	return err
}

func (p *postgresRiderRepo) CreateOTPSession(ctx context.Context, phone, otpHash, purpose string, ttl time.Duration) error {
	expiresAt := time.Now().Add(ttl)
	_, err := p.dbPool.Exec(ctx, `
		INSERT INTO rider_otp_sessions (phone, otp_hash, purpose, expires_at)
		VALUES ($1, $2, $3, $4)`, phone, otpHash, purpose, expiresAt)
	return err
}

func (p *postgresRiderRepo) GetActiveOTPSession(ctx context.Context, phone, purpose string) (*domain.RiderOTPSession, error) {
	q := `
		SELECT id, phone, otp_hash, purpose, attempts, max_attempts, expires_at, used_at, created_at
		FROM rider_otp_sessions
		WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
		ORDER BY created_at DESC
		LIMIT 1`
	var s domain.RiderOTPSession
	err := p.dbPool.QueryRow(ctx, q, phone, purpose).Scan(
		&s.ID, &s.Phone, &s.OTPHash, &s.Purpose, &s.Attempts, &s.MaxAttempts, &s.ExpiresAt, &s.UsedAt, &s.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (p *postgresRiderRepo) IncrementOTPAttempts(ctx context.Context, sessionID string) error {
	_, err := p.dbPool.Exec(ctx, `UPDATE rider_otp_sessions SET attempts = attempts + 1 WHERE id = $1::uuid`, sessionID)
	return err
}

func (p *postgresRiderRepo) MarkOTPUsed(ctx context.Context, sessionID string) error {
	_, err := p.dbPool.Exec(ctx, `UPDATE rider_otp_sessions SET used_at = now() WHERE id = $1::uuid`, sessionID)
	return err
}

const garageColumns = `id, rider_id, make, model, year, car_type, transmission, fuel_type,
	registration_plate, color, insurance_expiry, rc_document_url, insurance_document_url,
	puc_document_url, puc_expiry, is_default, is_active, created_at, updated_at`

func scanGarageCar(row rowScanner) (*domain.RiderGarageCar, error) {
	var c domain.RiderGarageCar
	err := row.Scan(
		&c.ID, &c.RiderID, &c.Make, &c.Model, &c.Year, &c.CarType, &c.Transmission, &c.FuelType,
		&c.RegistrationPlate, &c.Color, &c.InsuranceExpiry, &c.RCDocumentURL, &c.InsuranceDocumentURL,
		&c.PUCDocumentURL, &c.PUCExpiry, &c.IsDefault, &c.IsActive, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *postgresRiderRepo) UpsertGarageCar(ctx context.Context, car *domain.RiderGarageCar) (*domain.RiderGarageCar, error) {
	tx, err := p.dbPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Honour the single-default-car invariant before writing the new/updated row so the
	// rider_garage partial unique index (uq_rider_garage_one_default) never trips.
	if car.IsDefault {
		if _, err := tx.Exec(ctx, `UPDATE rider_garage SET is_default = false WHERE rider_id = $1::uuid`, car.RiderID); err != nil {
			return nil, err
		}
	}

	var saved *domain.RiderGarageCar
	if car.ID == "" {
		q := `
			INSERT INTO rider_garage
				(rider_id, make, model, year, car_type, transmission, fuel_type,
				 registration_plate, color, insurance_expiry, rc_document_url,
				 insurance_document_url, puc_document_url, puc_expiry, is_default, is_active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, true)
			RETURNING ` + garageColumns
		saved, err = scanGarageCar(tx.QueryRow(ctx, q,
			car.RiderID, car.Make, car.Model, car.Year, car.CarType, car.Transmission, car.FuelType,
			car.RegistrationPlate, car.Color, car.InsuranceExpiry, car.RCDocumentURL,
			car.InsuranceDocumentURL, car.PUCDocumentURL, car.PUCExpiry, car.IsDefault))
	} else {
		q := `
			UPDATE rider_garage SET
				make = $3, model = $4, year = $5, car_type = $6, transmission = $7, fuel_type = $8,
				registration_plate = $9, color = $10, insurance_expiry = $11, rc_document_url = $12,
				insurance_document_url = $13, puc_document_url = $14, puc_expiry = $15, is_default = $16,
				updated_at = now()
			WHERE id = $1::uuid AND rider_id = $2::uuid
			RETURNING ` + garageColumns
		saved, err = scanGarageCar(tx.QueryRow(ctx, q,
			car.ID, car.RiderID, car.Make, car.Model, car.Year, car.CarType, car.Transmission, car.FuelType,
			car.RegistrationPlate, car.Color, car.InsuranceExpiry, car.RCDocumentURL,
			car.InsuranceDocumentURL, car.PUCDocumentURL, car.PUCExpiry, car.IsDefault))
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return saved, nil
}

func (p *postgresRiderRepo) GetGarageCars(ctx context.Context, riderID string) ([]*domain.RiderGarageCar, error) {
	q := `SELECT ` + garageColumns + ` FROM rider_garage WHERE rider_id = $1::uuid AND is_active ORDER BY is_default DESC, created_at DESC`
	rows, err := p.dbPool.Query(ctx, q, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cars := make([]*domain.RiderGarageCar, 0)
	for rows.Next() {
		c, err := scanGarageCar(rows)
		if err != nil {
			return nil, err
		}
		cars = append(cars, c)
	}
	return cars, rows.Err()
}

func (p *postgresRiderRepo) DeleteGarageCar(ctx context.Context, carID, riderID string) error {
	// Soft delete: orders may reference garage_car_id, so the row is retained for history.
	_, err := p.dbPool.Exec(ctx, `UPDATE rider_garage SET is_active = false, is_default = false, updated_at = now() WHERE id = $1::uuid AND rider_id = $2::uuid`, carID, riderID)
	return err
}

func (p *postgresRiderRepo) SetDefaultCar(ctx context.Context, carID, riderID string) error {
	tx, err := p.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE rider_garage SET is_default = false WHERE rider_id = $1::uuid`, riderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE rider_garage SET is_default = true, updated_at = now() WHERE id = $1::uuid AND rider_id = $2::uuid AND is_active`, carID, riderID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

const savedPlaceSelect = `id, rider_id, label, display_name, address_text, ST_Y(location), ST_X(location), is_active, created_at`

func scanSavedPlace(row rowScanner) (*domain.RiderSavedPlace, error) {
	var pl domain.RiderSavedPlace
	err := row.Scan(&pl.ID, &pl.RiderID, &pl.Label, &pl.DisplayName, &pl.AddressText, &pl.Lat, &pl.Lng, &pl.IsActive, &pl.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &pl, nil
}

func (p *postgresRiderRepo) UpsertSavedPlace(ctx context.Context, place *domain.RiderSavedPlace) (*domain.RiderSavedPlace, error) {
	if place.ID == "" {
		q := `
			INSERT INTO rider_saved_places (rider_id, label, display_name, address_text, location)
			VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))
			RETURNING ` + savedPlaceSelect
		return scanSavedPlace(p.dbPool.QueryRow(ctx, q, place.RiderID, place.Label, place.DisplayName, place.AddressText, place.Lng, place.Lat))
	}
	q := `
		UPDATE rider_saved_places SET
			label = $3, display_name = $4, address_text = $5,
			location = ST_SetSRID(ST_MakePoint($6, $7), 4326)
		WHERE id = $1::uuid AND rider_id = $2::uuid
		RETURNING ` + savedPlaceSelect
	return scanSavedPlace(p.dbPool.QueryRow(ctx, q, place.ID, place.RiderID, place.Label, place.DisplayName, place.AddressText, place.Lng, place.Lat))
}

func (p *postgresRiderRepo) GetSavedPlaces(ctx context.Context, riderID string) ([]*domain.RiderSavedPlace, error) {
	q := `SELECT ` + savedPlaceSelect + ` FROM rider_saved_places WHERE rider_id = $1::uuid AND is_active ORDER BY created_at DESC`
	rows, err := p.dbPool.Query(ctx, q, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	places := make([]*domain.RiderSavedPlace, 0)
	for rows.Next() {
		pl, err := scanSavedPlace(rows)
		if err != nil {
			return nil, err
		}
		places = append(places, pl)
	}
	return places, rows.Err()
}

func (p *postgresRiderRepo) DeleteSavedPlace(ctx context.Context, placeID, riderID string) error {
	_, err := p.dbPool.Exec(ctx, `UPDATE rider_saved_places SET is_active = false WHERE id = $1::uuid AND rider_id = $2::uuid`, placeID, riderID)
	return err
}

func (p *postgresRiderRepo) DeleteSavedPlaceByLabel(ctx context.Context, riderID, label string) error {
	// HOME/WORK are singletons: hard-delete the prior entry so the new one replaces it cleanly.
	_, err := p.dbPool.Exec(ctx, `DELETE FROM rider_saved_places WHERE rider_id = $1::uuid AND label = $2`, riderID, label)
	return err
}

func scanEmergencyContact(row rowScanner) (*domain.RiderEmergencyContact, error) {
	var c domain.RiderEmergencyContact
	err := row.Scan(&c.ID, &c.RiderID, &c.Name, &c.Phone, &c.Relationship, &c.AutoShareTrip, &c.DisplayOrder, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *postgresRiderRepo) GetEmergencyContacts(ctx context.Context, riderID string) ([]*domain.RiderEmergencyContact, error) {
	q := `SELECT id, rider_id, name, phone, relationship, auto_share_trip, display_order, created_at
		FROM rider_emergency_contacts WHERE rider_id = $1::uuid ORDER BY display_order, created_at`
	rows, err := p.dbPool.Query(ctx, q, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	contacts := make([]*domain.RiderEmergencyContact, 0)
	for rows.Next() {
		c, err := scanEmergencyContact(rows)
		if err != nil {
			return nil, err
		}
		contacts = append(contacts, c)
	}
	return contacts, rows.Err()
}

func (p *postgresRiderRepo) UpsertEmergencyContact(ctx context.Context, c *domain.RiderEmergencyContact) error {
	if c.ID == "" {
		// INSERT path is guarded by the rider_emergency_contacts max-3 trigger.
		_, err := p.dbPool.Exec(ctx, `
			INSERT INTO rider_emergency_contacts (rider_id, name, phone, relationship, auto_share_trip, display_order)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			c.RiderID, c.Name, c.Phone, c.Relationship, c.AutoShareTrip, c.DisplayOrder)
		return err
	}
	_, err := p.dbPool.Exec(ctx, `
		UPDATE rider_emergency_contacts SET name = $3, phone = $4, relationship = $5, auto_share_trip = $6, display_order = $7
		WHERE id = $1::uuid AND rider_id = $2::uuid`,
		c.ID, c.RiderID, c.Name, c.Phone, c.Relationship, c.AutoShareTrip, c.DisplayOrder)
	return err
}

func (p *postgresRiderRepo) DeleteEmergencyContact(ctx context.Context, contactID, riderID string) error {
	_, err := p.dbPool.Exec(ctx, `DELETE FROM rider_emergency_contacts WHERE id = $1::uuid AND rider_id = $2::uuid`, contactID, riderID)
	return err
}

func (p *postgresRiderRepo) GetOrCreateWallet(ctx context.Context, riderID string) (*domain.RiderWallet, error) {
	if _, err := p.dbPool.Exec(ctx, `INSERT INTO rider_wallet (rider_id) VALUES ($1::uuid) ON CONFLICT (rider_id) DO NOTHING`, riderID); err != nil {
		return nil, err
	}
	var wlt domain.RiderWallet
	err := p.dbPool.QueryRow(ctx, `SELECT id, rider_id, balance_paise, locked_paise, created_at, updated_at FROM rider_wallet WHERE rider_id = $1::uuid`, riderID).Scan(
		&wlt.ID, &wlt.RiderID, &wlt.BalancePaise, &wlt.LockedPaise, &wlt.CreatedAt, &wlt.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &wlt, nil
}

func (p *postgresRiderRepo) GetWalletTransactions(ctx context.Context, riderID string, limit, offset int) ([]*domain.RiderWalletTransaction, int64, error) {
	var total int64
	if err := p.dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM rider_wallet_transactions WHERE rider_id = $1::uuid`, riderID).Scan(&total); err != nil {
		return nil, 0, err
	}
	q := `
		SELECT id, rider_id, type, amount_paise, balance_after_paise, reference_id, reference_type, description, idempotency_key, created_at
		FROM rider_wallet_transactions WHERE rider_id = $1::uuid ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := p.dbPool.Query(ctx, q, riderID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	txns := make([]*domain.RiderWalletTransaction, 0)
	for rows.Next() {
		var t domain.RiderWalletTransaction
		if err := rows.Scan(&t.ID, &t.RiderID, &t.Type, &t.AmountPaise, &t.BalanceAfterPaise, &t.ReferenceID, &t.ReferenceType, &t.Description, &t.IdempotencyKey, &t.CreatedAt); err != nil {
			return nil, 0, err
		}
		txns = append(txns, &t)
	}
	return txns, total, rows.Err()
}

func (p *postgresRiderRepo) SaveDeviceToken(ctx context.Context, riderID, token, platform string) error {
	_, err := p.dbPool.Exec(ctx, `
		INSERT INTO rider_device_tokens (rider_id, device_token, platform)
		VALUES ($1::uuid, $2, $3)
		ON CONFLICT (device_token) DO UPDATE SET rider_id = EXCLUDED.rider_id, platform = EXCLUDED.platform, is_active = true`,
		riderID, token, platform)
	return err
}

func (p *postgresRiderRepo) GetActiveDeviceTokens(ctx context.Context, riderID string) ([]string, error) {
	rows, err := p.dbPool.Query(ctx, `SELECT device_token FROM rider_device_tokens WHERE rider_id = $1::uuid AND is_active`, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := make([]string, 0)
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, rows.Err()
}

func (p *postgresRiderRepo) DeactivateDeviceToken(ctx context.Context, riderID, token string) error {
	_, err := p.dbPool.Exec(ctx, `UPDATE rider_device_tokens SET is_active = false WHERE rider_id = $1::uuid AND device_token = $2`, riderID, token)
	return err
}

const referralColumns = `id, referrer_rider_id, referred_rider_id, referral_code, status, reward_amount_paise, rewarded_at, created_at`

func scanReferral(row rowScanner) (*domain.RiderReferral, error) {
	var r domain.RiderReferral
	err := row.Scan(&r.ID, &r.ReferrerRiderID, &r.ReferredRiderID, &r.ReferralCode, &r.Status, &r.RewardAmountPaise, &r.RewardedAt, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (p *postgresRiderRepo) GetReferralByCode(ctx context.Context, code string) (*domain.RiderReferral, error) {
	q := `SELECT ` + referralColumns + ` FROM rider_referrals WHERE referral_code = $1`
	return scanReferral(p.dbPool.QueryRow(ctx, q, code))
}

func (p *postgresRiderRepo) GetRiderReferrals(ctx context.Context, riderID string) ([]*domain.RiderReferral, error) {
	q := `SELECT ` + referralColumns + ` FROM rider_referrals WHERE referrer_rider_id = $1::uuid OR referred_rider_id = $1::uuid ORDER BY created_at DESC`
	rows, err := p.dbPool.Query(ctx, q, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := make([]*domain.RiderReferral, 0)
	for rows.Next() {
		r, err := scanReferral(rows)
		if err != nil {
			return nil, err
		}
		refs = append(refs, r)
	}
	return refs, rows.Err()
}

func (p *postgresRiderRepo) GetNotifications(ctx context.Context, riderID string, limit, offset int) ([]*domain.RiderNotification, error) {
	q := `SELECT id, rider_id, type, title, body, data, is_read, created_at
		FROM rider_notifications WHERE rider_id = $1::uuid ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := p.dbPool.Query(ctx, q, riderID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	notifs := make([]*domain.RiderNotification, 0)
	for rows.Next() {
		var n domain.RiderNotification
		var data []byte
		if err := rows.Scan(&n.ID, &n.RiderID, &n.Type, &n.Title, &n.Body, &data, &n.IsRead, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.Data = data
		notifs = append(notifs, &n)
	}
	return notifs, rows.Err()
}

func (p *postgresRiderRepo) MarkNotificationRead(ctx context.Context, notificationID, riderID string) error {
	tag, err := p.dbPool.Exec(ctx, `UPDATE rider_notifications SET is_read = true WHERE id = $1::uuid AND rider_id = $2::uuid`, notificationID, riderID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("notification %s not found for rider: %w", notificationID, pgx.ErrNoRows)
	}
	return nil
}
