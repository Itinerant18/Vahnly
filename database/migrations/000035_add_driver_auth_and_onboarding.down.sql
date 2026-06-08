DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS driver_documents;

ALTER TABLE drivers 
DROP COLUMN IF EXISTS email,
DROP COLUMN IF EXISTS password_hash,
DROP COLUMN IF EXISTS onboarding_step,
DROP COLUMN IF EXISTS onboarding_data,
DROP COLUMN IF EXISTS verification_status,
DROP COLUMN IF EXISTS last_login_at;

DROP TYPE IF EXISTS driver_verification_status;
