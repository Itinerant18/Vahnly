-- Driver-managed vehicles (FEAT-002 vehicles backend).
CREATE TABLE IF NOT EXISTS driver_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    make VARCHAR(60) NOT NULL,
    model VARCHAR(60) NOT NULL,
    license_plate VARCHAR(20) NOT NULL,
    transmission VARCHAR(12) NOT NULL DEFAULT 'AUTOMATIC',
    rc_status VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
    insurance_status VARCHAR(24) NOT NULL DEFAULT 'AWAITING_UPLOAD',
    puc_status VARCHAR(24) NOT NULL DEFAULT 'AWAITING_UPLOAD',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_vehicles_driver ON driver_vehicles(driver_id) WHERE is_active;
