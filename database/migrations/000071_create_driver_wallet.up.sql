-- Driver wallet balance + ledger (FEAT-002 wallet backend).
CREATE TABLE IF NOT EXISTS driver_wallets (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    balance_paise BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL,
    entry_type VARCHAR(8) NOT NULL, -- CREDIT | DEBIT
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_wallet_txn ON driver_wallet_transactions(driver_id, created_at DESC);
