-- Phase 5: per-rider referral code + promo trip-type applicability.
-- NOTE: promo_codes / rider_referrals already exist (migrations 088 / 082); this
-- only adds the two columns Phase 5 introduces.
ALTER TABLE riders
    ADD COLUMN IF NOT EXISTS referral_code VARCHAR(8) UNIQUE;

ALTER TABLE promo_codes
    ADD COLUMN IF NOT EXISTS applicable_trip_types TEXT[];

-- rider_referrals.referral_code stored the REFERRER's code, which is reused for
-- every rider they refer — so its original UNIQUE constraint is wrong. Replace it
-- with the correct invariant: a rider can be referred at most once.
ALTER TABLE rider_referrals DROP CONSTRAINT IF EXISTS rider_referrals_referral_code_key;
ALTER TABLE rider_referrals ADD CONSTRAINT uq_rider_referrals_referred UNIQUE (referred_rider_id);
