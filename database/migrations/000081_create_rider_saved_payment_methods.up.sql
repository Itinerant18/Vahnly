-- Rider tokenized payment methods (provider_token stored encrypted by app). Rider domain migration 8/13.
CREATE TABLE IF NOT EXISTS rider_saved_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    method_type VARCHAR(20) NOT NULL CHECK (method_type IN ('CARD','UPI','WALLET')),
    provider VARCHAR(30),
    provider_token TEXT NOT NULL,
    display_label VARCHAR(50),
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_saved_payment_methods_rider ON rider_saved_payment_methods(rider_id);
