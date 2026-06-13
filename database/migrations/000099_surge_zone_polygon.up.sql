-- Manual surge zones can be drawn as polygons (array of [lat,lng] vertices), not
-- just circles. center_lat/lng/radius_m remain as a fallback / map-centering hint.
ALTER TABLE manual_surge_zones
    ADD COLUMN IF NOT EXISTS polygon JSONB;
