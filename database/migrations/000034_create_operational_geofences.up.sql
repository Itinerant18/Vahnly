CREATE TABLE IF NOT EXISTS operational_geofences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_name VARCHAR(100) UNIQUE NOT NULL,
    city_prefix VARCHAR(10) NOT NULL,
    boundary GEOMETRY(Polygon, 4326) NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_geofences_boundary ON operational_geofences USING GIST(boundary);
