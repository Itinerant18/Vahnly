ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS user_agent;
ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS after_value;
ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS before_value;
ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS entity_id;
ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS entity_type;
ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS module;
ALTER TABLE admin_audit_logs DROP COLUMN IF EXISTS admin_role;
