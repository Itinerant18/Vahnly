-- Phone OTP challenge sessions (keyed by phone, pre-account allowed). Rider domain migration 2/13.
CREATE TABLE IF NOT EXISTS rider_otp_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('LOGIN','PHONE_CHANGE','ACCOUNT_DELETE')),
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_otp_sessions_phone ON rider_otp_sessions(phone);
CREATE INDEX IF NOT EXISTS idx_rider_otp_sessions_expires_at ON rider_otp_sessions(expires_at);
