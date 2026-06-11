package service

import (
	"context"
	"testing"
)

func TestStaticPromo_FlatDiscount(t *testing.T) {
	v := NewStaticPromoValidator()
	res, err := v.Validate(context.Background(), "WELCOME50", 20000, "KOL")
	if err != nil || res == nil || res.DiscountPaise != 5000 {
		t.Fatalf("WELCOME50 on Rs200 fare: want 5000, got %+v (err %v)", res, err)
	}
}

func TestStaticPromo_BelowMinimum(t *testing.T) {
	v := NewStaticPromoValidator()
	// WELCOME50 requires fare >= 10000 paise.
	if res, _ := v.Validate(context.Background(), "WELCOME50", 9000, "KOL"); res != nil {
		t.Fatalf("below minimum should not apply, got %+v", res)
	}
}

func TestStaticPromo_PercentCapped(t *testing.T) {
	v := NewStaticPromoValidator()
	// SAVE10 = 10%, capped at 10000 paise. 10% of 200000 = 20000 -> capped to 10000.
	res, _ := v.Validate(context.Background(), "SAVE10", 200000, "KOL")
	if res == nil || res.DiscountPaise != 10000 {
		t.Fatalf("SAVE10 cap: want 10000, got %+v", res)
	}
}

func TestStaticPromo_Unknown(t *testing.T) {
	v := NewStaticPromoValidator()
	if res, _ := v.Validate(context.Background(), "NOPE", 50000, "KOL"); res != nil {
		t.Fatalf("unknown code should not apply, got %+v", res)
	}
}

func TestStaticPromo_NeverExceedsFare(t *testing.T) {
	v := NewStaticPromoValidator()
	// FLAT100 = 10000 paise off; on a fare of exactly its minimum the discount
	// must never exceed the fare.
	res, _ := v.Validate(context.Background(), "FLAT100", 30000, "KOL")
	if res != nil && res.DiscountPaise > 30000 {
		t.Fatalf("discount %d exceeds fare", res.DiscountPaise)
	}
}
