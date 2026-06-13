-- Admin-drawn manual surge zones (circular: center + radius). The dispatch surge
-- engine applies the highest active multiplier whose zone contains an order pickup.
CREATE TABLE IF NOT EXISTS manual_surge_zones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    city_prefix VARCHAR(10)  NOT NULL,
    center_lat  DOUBLE PRECISION NOT NULL,
    center_lng  DOUBLE PRECISION NOT NULL,
    radius_m    INTEGER NOT NULL DEFAULT 1000,
    multiplier  NUMERIC(3,2) NOT NULL CHECK (multiplier >= 1.0 AND multiplier <= 5.0),
    reason      TEXT,
    created_by  VARCHAR(255),
    expires_at  TIMESTAMPTZ NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manual_surge_active ON manual_surge_zones(city_prefix, is_active, expires_at);
