-- Revert onboarding profile columns from drivers table
ALTER TABLE drivers
DROP COLUMN IF EXISTS transmission_manual,
DROP COLUMN IF EXISTS transmission_automatic,
DROP COLUMN IF EXISTS years_of_experience,
DROP COLUMN IF EXISTS emergency_contact_name,
DROP COLUMN IF EXISTS emergency_contact_relation,
DROP COLUMN IF EXISTS emergency_contact_phone,
DROP COLUMN IF EXISTS quiz_score,
DROP COLUMN IF EXISTS quiz_passed,
DROP COLUMN IF EXISTS profile_photo_url,
DROP COLUMN IF EXISTS date_of_birth,
DROP COLUMN IF EXISTS gender,
DROP COLUMN IF EXISTS languages,
DROP COLUMN IF EXISTS permanent_address,
DROP COLUMN IF EXISTS current_address;

-- Drop onboarding-specific tables
DROP TABLE IF EXISTS driver_bank_details;
DROP TABLE IF EXISTS driver_kyc_documents;
