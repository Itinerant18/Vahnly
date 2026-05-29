CREATE TABLE IF NOT EXISTS payment_intents (
    id VARCHAR(100) PRIMARY KEY,          -- External provider tracking identifier (e.g., 'pi_1Gbf32...')
    order_id UUID NOT NULL REFERENCES orders(id),
    amount_paise BIGINT NOT NULL,        -- Strict 64-bit integer representation of transaction amount
    currency VARCHAR(10) NOT NULL,       -- 'INR', 'USD'
    payment_status VARCHAR(30) NOT NULL, -- 'PENDING', 'SUCCEEDED', 'FAILED'
    provider_type VARCHAR(20) NOT NULL,  -- 'STRIPE', 'RAZORPAY'
    idempotency_key VARCHAR(100) UNIQUE, -- Extracted provider event hash constraint
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Index order associations for rapid lookups during asynchronous callbacks
CREATE INDEX IF NOT EXISTS idx_payment_intents_order_id ON payment_intents(order_id);
