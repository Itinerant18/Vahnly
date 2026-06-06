-- ── Corporate Accounts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_accounts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name          VARCHAR(255) NOT NULL,
    gstin                 VARCHAR(20)  DEFAULT '' NOT NULL,
    billing_email         VARCHAR(255) NOT NULL,
    billing_address       TEXT         DEFAULT '' NOT NULL,
    city_prefix           VARCHAR(10)  DEFAULT 'KOL' NOT NULL,
    plan_type             VARCHAR(20)  DEFAULT 'STANDARD' NOT NULL CHECK (plan_type IN ('STANDARD','PREMIUM','ENTERPRISE')),
    is_active             BOOLEAN      DEFAULT true NOT NULL,
    credit_limit_paise    BIGINT       DEFAULT 0 NOT NULL,
    current_balance_paise BIGINT       DEFAULT 0 NOT NULL,
    contract_start_date   DATE,
    contract_end_date     DATE,
    primary_contact_name  VARCHAR(100) DEFAULT '' NOT NULL,
    primary_contact_phone VARCHAR(20)  DEFAULT '' NOT NULL,
    sso_provider          VARCHAR(50)  DEFAULT '' NOT NULL,
    sso_domain            VARCHAR(100) DEFAULT '' NOT NULL,
    created_by            VARCHAR(255) DEFAULT '' NOT NULL,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ── Corporate Employees ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_employees (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corporate_id         UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    name                 VARCHAR(200) NOT NULL,
    email                VARCHAR(255) NOT NULL,
    phone                VARCHAR(20)  DEFAULT '' NOT NULL,
    employee_id          VARCHAR(100) DEFAULT '' NOT NULL,
    department           VARCHAR(100) DEFAULT '' NOT NULL,
    cost_center          VARCHAR(100) DEFAULT '' NOT NULL,
    role                 VARCHAR(20)  DEFAULT 'EMPLOYEE' NOT NULL CHECK (role IN ('ADMIN','MANAGER','EMPLOYEE')),
    is_active            BOOLEAN      DEFAULT true NOT NULL,
    monthly_limit_paise  BIGINT       DEFAULT 0 NOT NULL,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE (corporate_id, email)
);

CREATE INDEX IF NOT EXISTS idx_corp_employees_corp ON corporate_employees(corporate_id, is_active);

-- ── Corporate Trip Policies ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_trip_policies (
    id                       SERIAL PRIMARY KEY,
    corporate_id             UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    policy_name              VARCHAR(200) NOT NULL,
    max_fare_paise           BIGINT   DEFAULT 0 NOT NULL,
    allowed_trip_types       VARCHAR(30)[] DEFAULT '{}'::VARCHAR(30)[] NOT NULL,
    allowed_car_types        VARCHAR(30)[] DEFAULT '{}'::VARCHAR(30)[] NOT NULL,
    requires_approval        BOOLEAN  DEFAULT false NOT NULL,
    approval_threshold_paise BIGINT   DEFAULT 0 NOT NULL,
    allowed_hours_start      INT      DEFAULT 0  NOT NULL CHECK (allowed_hours_start >= 0 AND allowed_hours_start <= 23),
    allowed_hours_end        INT      DEFAULT 23 NOT NULL CHECK (allowed_hours_end >= 0 AND allowed_hours_end <= 23),
    allowed_days             VARCHAR(10)[] DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::VARCHAR(10)[] NOT NULL,
    cost_center_required     BOOLEAN  DEFAULT false NOT NULL,
    is_default               BOOLEAN  DEFAULT true NOT NULL,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ── Corporate Invoices ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_invoices (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corporate_id   UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    period_start   DATE NOT NULL,
    period_end     DATE NOT NULL,
    total_trips    INT    DEFAULT 0 NOT NULL,
    subtotal_paise BIGINT DEFAULT 0 NOT NULL,
    gst_paise      BIGINT DEFAULT 0 NOT NULL,
    total_paise    BIGINT DEFAULT 0 NOT NULL,
    status         VARCHAR(20) DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT','SENT','PAID','OVERDUE','CANCELLED')),
    due_date       DATE,
    paid_at        TIMESTAMP WITH TIME ZONE,
    pdf_url        TEXT   DEFAULT '' NOT NULL,
    notes          TEXT   DEFAULT '' NOT NULL,
    created_by     VARCHAR(255) DEFAULT '' NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_corp_invoices_corp ON corporate_invoices(corporate_id, status);

-- Add corporate_id to orders for trip linkage
ALTER TABLE orders ADD COLUMN IF NOT EXISTS corporate_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_corporate ON orders(corporate_id) WHERE corporate_id IS NOT NULL;

-- ── Seed corporate accounts ───────────────────────────────────────────────────
INSERT INTO corporate_accounts (id, company_name, gstin, billing_email, city_prefix, plan_type, credit_limit_paise, current_balance_paise, primary_contact_name, primary_contact_phone, contract_start_date, contract_end_date, created_by)
VALUES
    ('c1000000-0000-0000-0000-000000000001', 'TechCorp India Pvt. Ltd.',     '29AABCT1332L1ZT', 'finance@techcorp.in',    'KOL', 'ENTERPRISE', 50000000, 8500000,  'Rahul Mehta',  '+91 9876501001', '2025-01-01', '2026-12-31', 'system'),
    ('c1000000-0000-0000-0000-000000000002', 'Accenture India',              '27AAACI5340M1ZE', 'travel@accenture.in',    'BLR', 'PREMIUM',    20000000, 3200000,  'Priya Sharma', '+91 9876501002', '2025-06-01', '2026-05-31', 'system'),
    ('c1000000-0000-0000-0000-000000000003', 'Deloitte Consulting India',    '07AAACD1234C1ZP', 'corp-travel@deloitte.in','KOL', 'STANDARD',   5000000,  1100000,  'Arun Joshi',   '+91 9876501003', '2026-01-01', '2026-12-31', 'system')
ON CONFLICT (id) DO NOTHING;

-- Seed employees for TechCorp
INSERT INTO corporate_employees (corporate_id, name, email, phone, employee_id, department, cost_center, role, monthly_limit_paise)
VALUES
    ('c1000000-0000-0000-0000-000000000001', 'Rahul Mehta',    'rahul.mehta@techcorp.in',    '+91 9876501001', 'TC-001', 'Engineering', 'ENG-KOL-01', 'ADMIN',    500000),
    ('c1000000-0000-0000-0000-000000000001', 'Ananya Bose',    'ananya.bose@techcorp.in',    '+91 9876501011', 'TC-011', 'Engineering', 'ENG-KOL-01', 'EMPLOYEE', 300000),
    ('c1000000-0000-0000-0000-000000000001', 'Vikash Das',     'vikash.das@techcorp.in',     '+91 9876501012', 'TC-012', 'Sales',       'SAL-KOL-01', 'EMPLOYEE', 400000),
    ('c1000000-0000-0000-0000-000000000001', 'Sinjini Roy',    'sinjini.roy@techcorp.in',    '+91 9876501013', 'TC-013', 'HR',          'HR-KOL-01',  'MANAGER',  250000),
    ('c1000000-0000-0000-0000-000000000002', 'Priya Sharma',   'priya.sharma@accenture.in',  '+91 9876501002', 'AC-001', 'Consulting',  'CON-BLR-01', 'ADMIN',    800000),
    ('c1000000-0000-0000-0000-000000000002', 'Rohan Pillai',   'rohan.pillai@accenture.in',  '+91 9876501021', 'AC-021', 'Technology',  'TEC-BLR-02', 'EMPLOYEE', 500000)
ON CONFLICT (corporate_id, email) DO NOTHING;

-- Seed trip policy for TechCorp
INSERT INTO corporate_trip_policies (corporate_id, policy_name, max_fare_paise, allowed_trip_types, allowed_car_types, requires_approval, approval_threshold_paise, cost_center_required, is_default)
VALUES
    ('c1000000-0000-0000-0000-000000000001', 'Standard Employee Policy', 50000, ARRAY['IN_CITY'], ARRAY['HATCHBACK','SEDAN'], false, 0, true, true),
    ('c1000000-0000-0000-0000-000000000001', 'Senior Staff Policy',      150000, ARRAY['IN_CITY','OUTSTATION'], ARRAY['SEDAN','SUV','PREMIUM'], true, 100000, true, false),
    ('c1000000-0000-0000-0000-000000000002', 'Accenture Default',        100000, ARRAY['IN_CITY'], ARRAY['SEDAN','SUV'], false, 0, false, true)
ON CONFLICT DO NOTHING;

-- Seed invoices
INSERT INTO corporate_invoices (id, corporate_id, invoice_number, period_start, period_end, total_trips, subtotal_paise, gst_paise, total_paise, status, due_date, created_by)
VALUES
    ('inv00000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'INV-TC-2026-05', '2026-05-01', '2026-05-31', 142, 7100000, 1278000, 8378000, 'PAID',    '2026-06-15', 'system'),
    ('inv00000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'INV-TC-2026-06', '2026-06-01', '2026-06-07', 38,  1900000, 342000,  2242000, 'SENT',    '2026-07-15', 'system'),
    ('inv00000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 'INV-AC-2026-05', '2026-05-01', '2026-05-31', 89,  4450000, 801000,  5251000, 'PAID',    '2026-06-15', 'system'),
    ('inv00000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000003', 'INV-DL-2026-04', '2026-04-01', '2026-04-30', 24,  1200000, 216000,  1416000, 'OVERDUE', '2026-05-31', 'system')
ON CONFLICT (invoice_number) DO NOTHING;

UPDATE corporate_invoices SET paid_at = NOW() - INTERVAL '20 days' WHERE invoice_number IN ('INV-TC-2026-05','INV-AC-2026-05');
