package service

import (
	"context"
	"strings"

	"github.com/platform/driver-delivery/internal/domain"
)

// PromoValidator resolves a promo code to a discount preview. The read path is
// non-mutating; per-rider usage is enforced (and locked) at redemption time
// inside the order-create transaction (see repository.InsertRiderOrder).
//
// Production wiring uses the DB-backed validator (repository.DBPromoValidator).
// StaticPromoValidator below is retained for unit tests with no database.
type PromoValidator interface {
	// Validate returns a discount preview, or nil when the code is unknown /
	// not applicable to the given fare + city. A nil error with a nil result
	// means "no discount", not a failure.
	Validate(ctx context.Context, code string, fareBeforeDiscountPaise int64, city string) (*domain.PromoResult, error)
}

type promoRule struct {
	flatPaise    int64
	percent      int
	capPaise     int64
	minFarePaise int64
}

// StaticPromoValidator is an in-memory validator used only in tests.
type StaticPromoValidator struct {
	promos map[string]promoRule
}

func NewStaticPromoValidator() *StaticPromoValidator {
	return &StaticPromoValidator{
		promos: map[string]promoRule{
			"WELCOME50": {flatPaise: 5000, minFarePaise: 10000},
			"FLAT100":   {flatPaise: 10000, minFarePaise: 30000},
			"SAVE10":    {percent: 10, capPaise: 10000, minFarePaise: 5000},
		},
	}
}

func (v *StaticPromoValidator) Validate(_ context.Context, code string, fareBeforeDiscountPaise int64, _ string) (*domain.PromoResult, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, nil
	}
	rule, ok := v.promos[code]
	if !ok || fareBeforeDiscountPaise < rule.minFarePaise {
		return nil, nil
	}

	var discount int64
	if rule.flatPaise > 0 {
		discount = rule.flatPaise
	} else {
		discount = fareBeforeDiscountPaise * int64(rule.percent) / 100
		if rule.capPaise > 0 && discount > rule.capPaise {
			discount = rule.capPaise
		}
	}
	if discount > fareBeforeDiscountPaise {
		discount = fareBeforeDiscountPaise
	}
	if discount <= 0 {
		return nil, nil
	}
	// Static validator has no DB id; redemption locking is skipped for it.
	return &domain.PromoResult{Code: code, DiscountPaise: discount}, nil
}
