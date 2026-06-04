DROP TABLE IF EXISTS admin_audit_logs;

ALTER TABLE system_admins DROP COLUMN IF EXISTS two_factor_secret;
ALTER TABLE system_admins DROP COLUMN IF EXISTS two_factor_enabled;
ALTER TABLE system_admins DROP COLUMN IF EXISTS sso_provider;
ALTER TABLE system_admins DROP COLUMN IF EXISTS sso_id;
ALTER TABLE system_admins DROP COLUMN IF EXISTS login_attempts;
ALTER TABLE system_admins DROP COLUMN IF EXISTS locked_until;
ALTER TABLE system_admins DROP COLUMN IF EXISTS device_fingerprint;
ALTER TABLE system_admins DROP COLUMN IF EXISTS ip_allow_list;
ALTER TABLE system_admins DROP COLUMN IF EXISTS city_scope;
ALTER TABLE system_admins DROP COLUMN IF EXISTS last_active_at;
