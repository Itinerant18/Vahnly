-- 000036_add_driver_compliance_fields.down.sql
ALTER TABLE drivers DROP COLUMN IF EXISTS has_manual_certification;
ALTER TABLE drivers DROP COLUMN IF EXISTS has_automatic_certification;
ALTER TABLE drivers DROP COLUMN IF EXISTS is_luxury_qualified;
ALTER TABLE drivers DROP COLUMN IF EXISTS background_check_status;
