ALTER TABLE rider_insurance_claims
    DROP COLUMN IF EXISTS amount_paise,
    DROP COLUMN IF EXISTS photos;
