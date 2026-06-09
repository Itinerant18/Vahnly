-- Add driver_id column to financial_ledger_entries table
ALTER TABLE financial_ledger_entries ADD COLUMN driver_id UUID REFERENCES drivers(id);

-- Track available wallets for immediate withdrawal limits
CREATE TABLE driver_wallets (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id),
    available_balance INT DEFAULT 0, -- Stored in Paisa (integer) to avoid float point issues
    currency VARCHAR(3) DEFAULT 'INR',
    auto_payout_enabled BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for trip analytics performance charts
CREATE INDEX idx_ledger_entries_driver_date ON financial_ledger_entries (driver_id, created_at);

-- In-app notifications persistence table mapping Feature 9 requirements
CREATE TABLE driver_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id),
    category VARCHAR(20) NOT NULL, -- 'ALL', 'TRIPS', 'EARNINGS', 'PROMOTIONS', 'SYSTEM'
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    opened_at TIMESTAMP
);
CREATE INDEX idx_driver_notifications_lookup ON driver_notifications (driver_id, is_read);
