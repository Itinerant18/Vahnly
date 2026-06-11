package domain

// PromoResult is the outcome of validating a promo code against a fare. It lives
// in domain so both the service (interface) and repository (implementation) can
// reference it without an import cycle.
type PromoResult struct {
	PromoCodeID   string `json:"promo_code_id,omitempty"`
	Code          string `json:"code"`
	DiscountPaise int64  `json:"discount_paise"`
}
