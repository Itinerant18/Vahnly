-- Rider referral codes and reward state. Rider domain migration 9/13.
CREATE TABLE IF NOT EXISTS rider_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_rider_id UUID REFERENCES riders(id),
    referred_rider_id UUID REFERENCES riders(id),
    referral_code VARCHAR(20) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','JOINED','FIRST_TRIP_DONE','REWARDED','EXPIRED'
    )),
    reward_amount_paise BIGINT DEFAULT 0,
    rewarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_referrals_referrer ON rider_referrals(referrer_rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_referrals_referred ON rider_referrals(referred_rider_id);
