-- 000036_add_driver_compliance_fields.up.sql
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS has_manual_certification BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS has_automatic_certification BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_luxury_qualified BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS background_check_status VARCHAR(20) DEFAULT 'PENDING' NOT NULL;
