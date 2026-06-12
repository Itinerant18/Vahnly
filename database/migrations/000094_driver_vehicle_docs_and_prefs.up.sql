-- Vehicle self-service: richer vehicle attributes + a per-document store with
-- expiry tracking, plus driver notification preferences, locale and soft-delete.

ALTER TABLE driver_vehicles
    ADD COLUMN IF NOT EXISTS year       INTEGER,
    ADD COLUMN IF NOT EXISTS fuel_type  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS car_type   VARCHAR(20);

CREATE TABLE IF NOT EXISTS vehicle_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id    UUID NOT NULL REFERENCES driver_vehicles(id) ON DELETE CASCADE,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('RC','INSURANCE','PUC')),
    storage_url   TEXT NOT NULL,
    expiry_date   DATE,
    status        VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id);

ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL
        DEFAULT '{"trip_offers":true,"earnings":true,"promotions":true,"safety":true}'::jsonb,
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
