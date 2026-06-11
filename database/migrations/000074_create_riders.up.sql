-- Rider accounts (car owners who hire a driver). Rider domain migration 1/13.
CREATE TABLE IF NOT EXISTS riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(15) NOT NULL UNIQUE,
    phone_verified BOOLEAN DEFAULT false,
    name VARCHAR(100),
    email VARCHAR(255) UNIQUE,
    email_verified BOOLEAN DEFAULT false,
    gender VARCHAR(10) CHECK (gender IN ('MALE','FEMALE','OTHER','PREFER_NOT')),
    date_of_birth DATE,
    profile_photo_url TEXT,
    preferred_language VARCHAR(10) DEFAULT 'en',
    kyc_level VARCHAR(20) DEFAULT 'BASIC' CHECK (kyc_level IN ('BASIC','VERIFIED')),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- phone and email already carry UNIQUE (hence indexed) constraints from the column definitions.
CREATE INDEX IF NOT EXISTS idx_riders_is_active ON riders(is_active);
