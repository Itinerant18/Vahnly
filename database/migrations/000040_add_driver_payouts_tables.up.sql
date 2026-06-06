-- Alter drivers table to add bank details and hold states
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS payout_hold BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS payout_hold_reason TEXT;

-- Create payouts / payout requests table
CREATE TABLE IF NOT EXISTS payout_requests (
    id VARCHAR(100) PRIMARY KEY,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL,
    tds_paise BIGINT DEFAULT 0 NOT NULL,
    professional_fees_paise BIGINT DEFAULT 0 NOT NULL,
    net_amount_paise BIGINT NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING' NOT NULL,
    failure_reason TEXT,
    hold_reason TEXT,
    payout_batch_id VARCHAR(100),
    bank_reference VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_payout_requests_driver ON payout_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
CREATE INDEX IF NOT EXISTS idx_payout_requests_batch ON payout_requests(payout_batch_id);

-- Update existing driver to be eligible for payouts
UPDATE drivers
SET 
    bank_name = 'HDFC Bank',
    bank_account_number = '50100239482718',
    bank_ifsc = 'HDFC0000123',
    bank_verified = true,
    background_check_status = 'APPROVED'
WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

-- Create more drivers for testing payout states
INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, background_check_status, bank_name, bank_account_number, bank_ifsc, bank_verified)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'KOL', 'Subir Das', '+919876543210', 'DL-12345-KOL', 'ONLINE_AVAILABLE', true, 'APPROVED', 'HDFC Bank', '50100239482718', 'HDFC0000123', true),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'KOL', 'Joydev Chatterjee', '+919876543222', 'DL-22222-KOL', 'ONLINE_AVAILABLE', true, 'APPROVED', 'ICICI Bank', '000401509283', 'ICIC0000004', true),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'KOL', 'Ramesh Sen', '+919876543233', 'DL-33333-KOL', 'OFFLINE', true, 'PENDING', 'State Bank of India', '30928392812', 'SBIN0000213', false),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'KOL', 'Vikram Singh', '+919876543244', 'DL-44444-KOL', 'OFFLINE', true, 'APPROVED', 'Axis Bank', '912010029384812', 'UTIB0000012', true)
ON CONFLICT (id) DO NOTHING;

-- Seed wallets for the new drivers to support double-entry ledger bookkeeping
INSERT INTO wallets (user_id, user_type, balance_paise)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'DRIVER', 300000),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'DRIVER', 150000),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'DRIVER', 450000)
ON CONFLICT (user_id) DO NOTHING;

-- Seed Payout Requests
INSERT INTO payout_requests (id, driver_id, amount_paise, tds_paise, professional_fees_paise, net_amount_paise, status, created_at, updated_at)
VALUES
    ('po_req_0001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 250000, 2500, 5000, 242500, 'PENDING', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
    ('po_req_0002', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 180000, 1800, 5000, 173200, 'APPROVED', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'),
    ('po_req_0003', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 320000, 3200, 5000, 311800, 'PAID', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
    ('po_req_0004', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 150000, 1500, 5000, 143500, 'FAILED', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
    ('po_req_0005', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 500000, 5000, 5000, 490000, 'HELD', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours')
ON CONFLICT (id) DO NOTHING;

-- Update specific details for failed/held seeded payouts
UPDATE payout_requests SET failure_reason = 'Invalid bank account details (verification failed by partner gateway)' WHERE id = 'po_req_0004';
UPDATE payout_requests SET hold_reason = 'Suspected driver fraud logs flagged by matching engine (discrepancy on H3 cell telemetry)' WHERE id = 'po_req_0005';
