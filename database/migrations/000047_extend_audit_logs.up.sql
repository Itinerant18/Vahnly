-- Extend admin_audit_logs for richer traceability (before/after values, module, entity)
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS admin_role   VARCHAR(50)  DEFAULT '' NOT NULL;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS module       VARCHAR(50)  DEFAULT '' NOT NULL;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS entity_type  VARCHAR(50)  DEFAULT '' NOT NULL;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS entity_id    VARCHAR(100) DEFAULT '' NOT NULL;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS before_value JSONB;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS after_value  JSONB;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS user_agent   VARCHAR(500) DEFAULT '' NOT NULL;

-- Indices for the new filter columns
CREATE INDEX IF NOT EXISTS idx_audit_module      ON admin_audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON admin_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_admin_role  ON admin_audit_logs(admin_role);

-- Seed a few sample audit entries across modules so the dashboard has data
DO $$
DECLARE v_admin_id UUID;
BEGIN
    SELECT id INTO v_admin_id FROM system_admins WHERE email = 'aniketkarmakar018@gmail.com' LIMIT 1;
    IF v_admin_id IS NULL THEN RETURN; END IF;

    INSERT INTO admin_audit_logs (admin_id, admin_email, admin_role, action, module, entity_type, entity_id, details, ip_address) VALUES
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'LOGIN',           'auth',       '',        '',        'Successful login via email+password', '127.0.0.1'),
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'KYC_APPROVE',     'compliance', 'DRIVER',  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'KYC approved for Subir Das', '127.0.0.1'),
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'FORCE_MATCH',     'dispatch',   'ORDER',   '',        'Manual override for order', '127.0.0.1'),
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'PAYOUT_APPROVED', 'finance',    'PAYOUT',  'po_req_0001', 'Bulk approved 1 payout', '127.0.0.1'),
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'FLAG_UPDATED',    'config',     'FLAG',    'batch_matching', 'Feature flag batch_matching enabled', '127.0.0.1'),
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'TICKET_RESOLVED', 'support',    'TICKET',  'TKT-10003', 'Resolved ticket TKT-10003 with voucher', '127.0.0.1'),
        (v_admin_id, 'aniketkarmakar018@gmail.com', 'SUPER_ADMIN', 'DRIVER_SUSPEND',  'drivers',    'DRIVER',  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'Suspended for GPS spoofing', '10.27.189.106')
    ON CONFLICT DO NOTHING;
END$$;
