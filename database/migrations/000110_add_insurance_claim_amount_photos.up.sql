-- Persist the claimed amount and uploaded photo URLs on insurance claims so the
-- rider's claim list and the file-claim response carry them (previously photos
-- were only echoed, never stored).
ALTER TABLE rider_insurance_claims
    ADD COLUMN IF NOT EXISTS amount_paise BIGINT,
    ADD COLUMN IF NOT EXISTS photos JSONB;
