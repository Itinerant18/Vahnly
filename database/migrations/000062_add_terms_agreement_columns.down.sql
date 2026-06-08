ALTER TABLE drivers 
DROP COLUMN IF EXISTS terms_accepted_at,
DROP COLUMN IF EXISTS terms_version,
DROP COLUMN IF EXISTS terms_ip_address;
