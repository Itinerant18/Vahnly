-- Rider wallet balance ledger head (one row per rider). Rider domain migration 6/13.
CREATE TABLE IF NOT EXISTS rider_wallet (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL UNIQUE REFERENCES riders(id),
    balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
    locked_paise BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
