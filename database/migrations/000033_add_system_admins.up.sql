CREATE TABLE IF NOT EXISTS system_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    region_prefix VARCHAR(10) NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Database seed query execution block
-- Maps Aniket's credential properties to core PostgreSQL structures
INSERT INTO system_admins (
    id, 
    full_name, 
    phone, 
    email, 
    password_hash, 
    role, 
    region_prefix, 
    is_active, 
    created_at
) VALUES (
    gen_random_uuid(),
    'Aniket karmakar',
    '+91 7602676448',
    'aniketkarmakar018@gmail.com',
    '$2a$12$NaKMQI27dkg6KDkRFe68S.rDWvrcjxVnG8UlgRtBFuLGtR8ugntx.', -- Strict Bcrypt hash matching password: "Aniket018"
    'SUPER_ADMIN',
    'KOL',
    true,
    CURRENT_TIMESTAMP
) ON CONFLICT (email) DO NOTHING;
