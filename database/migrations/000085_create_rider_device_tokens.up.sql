-- Rider push notification device tokens. Rider domain migration 12/13.
CREATE TABLE IF NOT EXISTS rider_device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL UNIQUE,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('IOS','ANDROID','WEB')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_device_tokens_rider ON rider_device_tokens(rider_id);
