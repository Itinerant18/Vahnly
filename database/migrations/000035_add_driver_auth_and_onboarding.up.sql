CREATE TYPE driver_verification_status AS ENUM ('ONBOARDING', 'PENDING', 'VERIFIED', 'REJECTED');

ALTER TABLE drivers 
ADD COLUMN email TEXT,
ADD COLUMN password_hash TEXT,
ADD COLUMN onboarding_step INT DEFAULT 1,
ADD COLUMN onboarding_data JSONB DEFAULT '{}',
ADD COLUMN verification_status driver_verification_status DEFAULT 'ONBOARDING',
ADD COLUMN last_login_at TIMESTAMP;

-- Securely link documents to specific onboarding steps
CREATE TABLE driver_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id),
    document_type TEXT NOT NULL, -- e.g., 'DL_FRONT', 'AADHAAR', 'POLICE_VERIFY'
    storage_url TEXT NOT NULL,
    status driver_verification_status DEFAULT 'PENDING',
    admin_reviewer_id UUID REFERENCES system_admins(id),
    reviewed_at TIMESTAMP
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id),
    action TEXT NOT NULL,
    device_id TEXT,
    ip_address TEXT,
    app_version TEXT,
    geo_location TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
