package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/platform/driver-delivery/internal/domain"
)

// DBPromoValidator validates promo codes against the promo_codes table. The
// Validate path is read-only (a preview); actual usage is locked + recorded at
// redemption time inside the order-create transaction.
type DBPromoValidator struct {
	dbPool *pgxpool.Pool
}

func NewDBPromoValidator(db *pgxpool.Pool) *DBPromoValidator {
	return &DBPromoValidator{dbPool: db}
}

// Validate returns a discount preview, or nil when the code is unknown /
// inactive / outside its window / city-mismatched / under the minimum fare /
// globally exhausted. Per-rider limits are enforced at redemption, not preview.
func (v *DBPromoValidator) Validate(ctx context.Context, code string, fareBeforeDiscountPaise int64, city string) (*domain.PromoResult, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, nil
	}

	var (
		id             string
		discountType   string
		discountValue  int64
		maxDiscount    int64
		minFare        int64
		maxRedemptions *int
		totalRedeemed  int
		cityPrefix     *string
		validFrom      time.Time
		validUntil     *time.Time
		isActive       bool
	)
	err := v.dbPool.QueryRow(ctx, `
		SELECT id::text, discount_type, discount_value, max_discount_paise, min_fare_paise,
		       max_redemptions, total_redeemed, city_prefix, valid_from, valid_until, is_active
		FROM promo_codes WHERE code = $1`, code).Scan(
		&id, &discountType, &discountValue, &maxDiscount, &minFare,
		&maxRedemptions, &totalRedeemed, &cityPrefix, &validFrom, &validUntil, &isActive,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if !isActive {
		return nil, nil
	}
	now := time.Now()
	if now.Before(validFrom) || (validUntil != nil && now.After(*validUntil)) {
		return nil, nil
	}
	if cityPrefix != nil && !strings.EqualFold(*cityPrefix, city) {
		return nil, nil
	}
	if fareBeforeDiscountPaise < minFare {
		return nil, nil
	}
	if maxRedemptions != nil && totalRedeemed >= *maxRedemptions {
		return nil, nil
	}

	discount := computeDiscount(discountType, discountValue, maxDiscount, fareBeforeDiscountPaise)
	if discount <= 0 {
		return nil, nil
	}
	return &domain.PromoResult{PromoCodeID: id, Code: code, DiscountPaise: discount}, nil
}

func computeDiscount(discountType string, discountValue, maxDiscount, fare int64) int64 {
	var d int64
	if discountType == "PERCENT" {
		d = fare * discountValue / 100
		if maxDiscount > 0 && d > maxDiscount {
			d = maxDiscount
		}
	} else { // FLAT
		d = discountValue
	}
	if d > fare {
		d = fare
	}
	return d
}

// redeemPromo locks the promo row, re-checks global + per-rider limits, and
// records the redemption. Returns false (without error) when the promo can no
// longer be applied — the caller then voids the discount on the order. Must run
// inside the order-create transaction so order + redemption commit atomically.
func redeemPromo(ctx context.Context, tx pgx.Tx, promoCodeID, riderID, orderID string, discountPaise int64) (bool, error) {
	var (
		maxRedemptions *int
		totalRedeemed  int
		perRiderLimit  int
		isActive       bool
		validFrom      time.Time
		validUntil     *time.Time
	)
	err := tx.QueryRow(ctx, `
		SELECT max_redemptions, total_redeemed, per_rider_limit, is_active, valid_from, valid_until
		FROM promo_codes WHERE id = $1::uuid FOR UPDATE`, promoCodeID).Scan(
		&maxRedemptions, &totalRedeemed, &perRiderLimit, &isActive, &validFrom, &validUntil,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	now := time.Now()
	if !isActive || now.Before(validFrom) || (validUntil != nil && now.After(*validUntil)) {
		return false, nil
	}
	if maxRedemptions != nil && totalRedeemed >= *maxRedemptions {
		return false, nil
	}

	var riderUses int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM promo_redemptions WHERE promo_code_id = $1::uuid AND rider_id = $2::uuid`,
		promoCodeID, riderID).Scan(&riderUses); err != nil {
		return false, err
	}
	if riderUses >= perRiderLimit {
		return false, nil
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO promo_redemptions (promo_code_id, rider_id, order_id, discount_paise)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`, promoCodeID, riderID, orderID, discountPaise); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `UPDATE promo_codes SET total_redeemed = total_redeemed + 1, updated_at = now() WHERE id = $1::uuid`, promoCodeID); err != nil {
		return false, err
	}
	return true, nil
}
