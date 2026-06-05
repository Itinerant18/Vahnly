CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(100) PRIMARY KEY,
    order_id UUID REFERENCES orders(id),
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL,
    txn_type VARCHAR(30) NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR' NOT NULL,
    gateway VARCHAR(30) NOT NULL,
    method VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL,
    gateway_response JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
    id VARCHAR(100) PRIMARY KEY,
    transaction_id VARCHAR(100) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL,
    approval_type VARCHAR(20) NOT NULL,
    approved_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    user_type VARCHAR(20) NOT NULL,
    balance_paise BIGINT DEFAULT 0 NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    txn_id VARCHAR(100) REFERENCES transactions(id) ON DELETE SET NULL,
    amount_paise BIGINT NOT NULL,
    entry_type VARCHAR(10) NOT NULL,
    reason_code VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(100) PRIMARY KEY,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    invoice_type VARCHAR(30) NOT NULL,
    recipient_name VARCHAR(100) NOT NULL,
    recipient_gstin VARCHAR(15),
    amount_paise BIGINT NOT NULL,
    cgst_paise BIGINT NOT NULL,
    sgst_paise BIGINT NOT NULL,
    igst_paise BIGINT NOT NULL,
    total_amount_paise BIGINT NOT NULL,
    status VARCHAR(30) NOT NULL,
    irn VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
    id VARCHAR(100) PRIMARY KEY,
    transaction_id VARCHAR(100) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL,
    status VARCHAR(30) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    evidence_url TEXT,
    gateway_dispute_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_transaction_id ON refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet ON wallet_ledger_entries(wallet_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_transaction ON disputes(transaction_id);

-- Seeding wallets for existing drivers
INSERT INTO wallets (user_id, user_type, balance_paise)
SELECT id, 'DRIVER', 250000 FROM drivers
ON CONFLICT (user_id) DO NOTHING;

-- Seeding wallets for existing riders
INSERT INTO wallets (user_id, user_type, balance_paise)
SELECT DISTINCT customer_id, 'RIDER', 100000 FROM orders
ON CONFLICT (user_id) DO NOTHING;

-- Seeding transactions for existing orders
INSERT INTO transactions (id, order_id, user_id, user_type, txn_type, amount_paise, gateway, method, status, created_at, updated_at, gateway_response)
SELECT 
    'pi_' || substring(encode(sha256(o.id::text::bytea), 'hex') from 1 for 24),
    o.id,
    o.customer_id,
    'RIDER',
    'TRIP',
    o.base_fare_paise,
    CASE 
        WHEN abs(hashtext(o.id::text)) % 3 = 0 THEN 'STRIPE'
        WHEN abs(hashtext(o.id::text)) % 3 = 1 THEN 'RAZORPAY'
        ELSE 'CASH'
    END,
    CASE 
        WHEN abs(hashtext(o.id::text)) % 3 = 0 THEN 'CARD'
        WHEN abs(hashtext(o.id::text)) % 3 = 1 THEN 'UPI'
        ELSE 'CASH'
    END,
    CASE 
        WHEN o.status = 'COMPLETED'::order_status_enum THEN 'SUCCESS'
        WHEN o.status = 'CANCELLED'::order_status_enum THEN 'FAILED'
        ELSE 'PENDING'
    END,
    o.created_at,
    o.created_at,
    '{"message": "Charge succeeded", "receipt_url": "https://example.com/receipt"}'::jsonb
FROM orders o
ON CONFLICT DO NOTHING;

-- Seeding wallet top-ups
INSERT INTO transactions (id, user_id, user_type, txn_type, amount_paise, gateway, method, status, created_at, updated_at, gateway_response)
SELECT 
    'ch_' || substring(encode(sha256((o.customer_id::text || o.created_at::text)::bytea), 'hex') from 1 for 24),
    o.customer_id,
    'RIDER',
    'WALLET_TOPUP',
    50000,
    'STRIPE',
    'CARD',
    'SUCCESS',
    o.created_at - interval '1 day',
    o.created_at - interval '1 day',
    '{"message": "Topup succeeded"}'::jsonb
FROM orders o
LIMIT 10
ON CONFLICT DO NOTHING;

-- Seeding wallet ledger entries for top-ups
INSERT INTO wallet_ledger_entries (wallet_id, txn_id, amount_paise, entry_type, reason_code, description, created_at)
SELECT 
    w.id,
    t.id,
    t.amount_paise,
    'CREDIT',
    'TOPUP',
    'UPI Topup Successful',
    t.created_at
FROM transactions t
JOIN wallets w ON w.user_id = t.user_id
WHERE t.txn_type = 'WALLET_TOPUP'
ON CONFLICT DO NOTHING;

-- Seeding driver payouts
INSERT INTO transactions (id, user_id, user_type, txn_type, amount_paise, gateway, method, status, created_at, updated_at, gateway_response)
SELECT 
    'po_' || substring(encode(sha256((d.id::text || d.created_at::text)::bytea), 'hex') from 1 for 24),
    d.id,
    'DRIVER',
    'PAYOUT',
    150000,
    'RAZORPAY',
    'UPI',
    'SUCCESS',
    d.created_at + interval '1 day',
    d.created_at + interval '1 day',
    '{"message": "Payout succeeded"}'::jsonb
FROM drivers d
LIMIT 5
ON CONFLICT DO NOTHING;

-- Seeding wallet ledger entries for payouts
INSERT INTO wallet_ledger_entries (wallet_id, txn_id, amount_paise, entry_type, reason_code, description, created_at)
SELECT 
    w.id,
    t.id,
    t.amount_paise,
    'DEBIT',
    'PAYOUT',
    'Weekly Driver Partner payout settlement transfer',
    t.created_at
FROM transactions t
JOIN wallets w ON w.user_id = t.user_id
WHERE t.txn_type = 'PAYOUT'
ON CONFLICT DO NOTHING;

-- Seeding refunds
INSERT INTO refunds (id, transaction_id, amount_paise, reason, status, approval_type, approved_by, created_at, updated_at)
SELECT 
    're_' || substring(encode(sha256((t.id::text || t.created_at::text)::bytea), 'hex') from 1 for 24),
    t.id,
    t.amount_paise,
    'Customer canceled trip under grace period',
    'PROCESSED',
    'AUTO',
    'SYSTEM',
    t.created_at + interval '5 minutes',
    t.created_at + interval '5 minutes'
FROM transactions t
WHERE t.status = 'FAILED' AND t.txn_type = 'TRIP'
LIMIT 5
ON CONFLICT DO NOTHING;

-- Seeding invoices
INSERT INTO invoices (id, order_id, invoice_type, recipient_name, recipient_gstin, amount_paise, cgst_paise, sgst_paise, igst_paise, total_amount_paise, status, irn, created_at)
SELECT 
    'INV-2026-' || substring(encode(sha256(o.id::text::bytea), 'hex') from 1 for 8),
    o.id,
    'RIDER_TRIP',
    'Rider ' || substring(o.customer_id::text from 1 for 6),
    NULL,
    o.base_fare_paise,
    (o.base_fare_paise * 9) / 100,
    (o.base_fare_paise * 9) / 100,
    0,
    o.base_fare_paise + (o.base_fare_paise * 18) / 100,
    'ISSUED',
    'irn_' || substring(encode(sha256(o.id::text::bytea), 'hex') from 1 for 24),
    o.created_at
FROM orders o
WHERE o.status = 'COMPLETED'
LIMIT 15
ON CONFLICT DO NOTHING;

-- Seeding disputes
INSERT INTO disputes (id, transaction_id, amount_paise, status, reason, evidence_url, gateway_dispute_id, created_at, updated_at)
SELECT 
    'dp_' || substring(encode(sha256(t.id::text::bytea), 'hex') from 1 for 24),
    t.id,
    t.amount_paise,
    'NEEDS_RESPONSE',
    'Fraudulent charge reported by customer',
    NULL,
    'dis_' || substring(encode(sha256(t.id::text::bytea), 'hex') from 1 for 24),
    t.created_at + interval '1 day',
    t.created_at + interval '1 day'
FROM transactions t
WHERE t.txn_type = 'TRIP' AND t.status = 'SUCCESS'
LIMIT 3
ON CONFLICT DO NOTHING;
