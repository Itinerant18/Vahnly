-- Rider-owned cars (the garage). Rider domain migration 3/13.
CREATE TABLE IF NOT EXISTS rider_garage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    car_type VARCHAR(20) NOT NULL CHECK (car_type IN ('HATCHBACK','SEDAN','SUV','PREMIUM')),
    transmission VARCHAR(15) NOT NULL CHECK (transmission IN ('MANUAL','AUTOMATIC')),
    fuel_type VARCHAR(15) CHECK (fuel_type IN ('PETROL','DIESEL','CNG','ELECTRIC','HYBRID')),
    registration_plate VARCHAR(20) NOT NULL,
    color VARCHAR(30),
    insurance_expiry DATE,
    rc_document_url TEXT,
    insurance_document_url TEXT,
    puc_document_url TEXT,
    puc_expiry DATE,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- At most one default car per rider.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rider_garage_one_default ON rider_garage(rider_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_rider_garage_rider ON rider_garage(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_garage_registration_plate ON rider_garage(registration_plate);
