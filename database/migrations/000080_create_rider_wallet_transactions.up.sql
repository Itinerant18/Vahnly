-- Append-only rider wallet transaction log. Rider domain migration 7/13.
CREATE TABLE IF NOT EXISTS rider_wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    type VARCHAR(20) NOT NULL CHECK (type IN (
        'TOPUP','TRIP_DEBIT','REFUND','CASHBACK',
        'REFERRAL_CREDIT','PROMO_CREDIT','ADJUSTMENT'
    )),
    amount_paise BIGINT NOT NULL,
    balance_after_paise BIGINT NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(30),
    description TEXT,
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_wallet_txn_rider ON rider_wallet_transactions(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_wallet_txn_type ON rider_wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_rider_wallet_txn_created_at ON rider_wallet_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_rider_wallet_txn_reference ON rider_wallet_transactions(reference_id);
