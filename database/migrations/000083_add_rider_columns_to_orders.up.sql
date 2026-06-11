-- Extend the existing orders table with rider-domain fields. Rider domain migration 10/13.
-- Additive only; uses IF NOT EXISTS so it is safe to re-run.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS rider_id UUID REFERENCES riders(id),
    ADD COLUMN IF NOT EXISTS garage_car_id UUID REFERENCES rider_garage(id),
    ADD COLUMN IF NOT EXISTS one_time_car_make VARCHAR(50),
    ADD COLUMN IF NOT EXISTS one_time_car_model VARCHAR(50),
    ADD COLUMN IF NOT EXISTS one_time_car_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS one_time_car_transmission VARCHAR(15),
    ADD COLUMN IF NOT EXISTS d4m_care_opted BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50),
    ADD COLUMN IF NOT EXISTS promo_discount_paise BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS wallet_applied_paise BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'CASH'
        CHECK (payment_method IN ('CASH','UPI','CARD','WALLET')),
    -- NOTE: spec wrote CHECK (rating BETWEEN 1 AND 5) but no column named `rating` exists;
    -- the constraint references the actual column instead.
    ADD COLUMN IF NOT EXISTS rider_rating_for_driver SMALLINT
        CHECK (rider_rating_for_driver BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rider_tip_paise BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rider_review_tags TEXT[],
    ADD COLUMN IF NOT EXISTS rider_review_comment TEXT,
    ADD COLUMN IF NOT EXISTS trip_share_token VARCHAR(64) UNIQUE,
    ADD COLUMN IF NOT EXISTS trip_share_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20)
        CHECK (cancelled_by IN ('RIDER','DRIVER','ADMIN','SYSTEM')),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS sos_triggered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ride_check_triggered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
