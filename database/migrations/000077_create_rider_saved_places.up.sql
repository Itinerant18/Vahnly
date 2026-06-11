-- Rider saved places (home/work/custom). Rider domain migration 4/13.
CREATE TABLE IF NOT EXISTS rider_saved_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    label VARCHAR(20) NOT NULL CHECK (label IN ('HOME','WORK','CUSTOM')),
    display_name VARCHAR(100) NOT NULL,
    address_text TEXT NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_saved_places_rider ON rider_saved_places(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_saved_places_location ON rider_saved_places USING GIST(location);
