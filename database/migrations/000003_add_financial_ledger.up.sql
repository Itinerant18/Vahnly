CREATE TABLE financial_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id),
    city_prefix VARCHAR(10) NOT NULL REFERENCES regional_cities(city_prefix),
    account_type VARCHAR(50) NOT NULL, -- 'RIDER_EXTERNAL_PAYMENT', 'DRIVER_EARNINGS', 'PLATFORM_COMMISSION'
    entry_type VARCHAR(10) NOT NULL,    -- 'DEBIT', 'CREDIT'
    amount_paise BIGINT NOT NULL,       -- Explicit 64-bit precision integer representation
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Optimize accounting verification lookups by indexing matching order keys
CREATE INDEX idx_financial_ledger_order_id ON financial_ledger_entries(order_id);
CREATE INDEX idx_financial_ledger_city_account ON financial_ledger_entries(city_prefix, account_type);
