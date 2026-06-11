ALTER TABLE rider_referrals DROP CONSTRAINT IF EXISTS uq_rider_referrals_referred;
ALTER TABLE rider_referrals ADD CONSTRAINT rider_referrals_referral_code_key UNIQUE (referral_code);
ALTER TABLE promo_codes DROP COLUMN IF EXISTS applicable_trip_types;
ALTER TABLE riders DROP COLUMN IF EXISTS referral_code;
