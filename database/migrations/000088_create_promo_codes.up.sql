-- Promo codes + per-rider redemption ledger for the rider booking flow.
CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('FLAT','PERCENT')),
    discount_value BIGINT NOT NULL CHECK (discount_value >= 0), -- paise for FLAT, percent for PERCENT
    max_discount_paise BIGINT NOT NULL DEFAULT 0,              -- cap for PERCENT; 0 = uncapped
    min_fare_paise BIGINT NOT NULL DEFAULT 0,
    max_redemptions INT,                                       -- NULL = unlimited global usage
    per_rider_limit INT NOT NULL DEFAULT 1,
    total_redeemed INT NOT NULL DEFAULT 0,
    city_prefix VARCHAR(10) REFERENCES regional_cities(city_prefix), -- NULL = all cities
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    discount_paise BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (promo_code_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_rider ON promo_redemptions(rider_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo ON promo_redemptions(promo_code_id);

-- Seed the demo codes the static validator previously hard-coded (all-cities, active).
INSERT INTO promo_codes (code, description, discount_type, discount_value, max_discount_paise, min_fare_paise, per_rider_limit)
VALUES
    ('WELCOME50', 'Flat Rs 50 off',     'FLAT',    5000,  0,     10000, 1),
    ('FLAT100',   'Flat Rs 100 off',    'FLAT',    10000, 0,     30000, 5),
    ('SAVE10',    '10% off up to Rs 100','PERCENT', 10,    10000, 5000,  10)
ON CONFLICT (code) DO NOTHING;
