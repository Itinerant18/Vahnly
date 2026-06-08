DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_verification_status') THEN
        CREATE TYPE driver_verification_status AS ENUM ('ONBOARDING', 'PENDING', 'VERIFIED', 'REJECTED');
    END IF;
END$$;

ALTER TABLE drivers 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS password_hash TEXT,
ADD COLUMN IF NOT EXISTS onboarding_step INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS onboarding_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS verification_status driver_verification_status DEFAULT 'ONBOARDING',
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS driver_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id),
    document_type TEXT NOT NULL, -- e.g., 'DL_FRONT', 'AADHAAR', 'POLICE_VERIFY'
    storage_url TEXT NOT NULL,
    status driver_verification_status DEFAULT 'PENDING',
    admin_reviewer_id UUID REFERENCES system_admins(id),
    reviewed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id),
    action TEXT NOT NULL,
    device_id TEXT,
    ip_address TEXT,
    app_version TEXT,
    geo_location TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
