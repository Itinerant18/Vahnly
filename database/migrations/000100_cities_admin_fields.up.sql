-- Admin-manageable city fields on the existing regional_cities table (the DB-driven
-- region source). Operating hours + supported trip types per city.
ALTER TABLE regional_cities
    ADD COLUMN IF NOT EXISTS operating_hours_start TIME,
    ADD COLUMN IF NOT EXISTS operating_hours_end   TIME,
    ADD COLUMN IF NOT EXISTS supported_trip_types  TEXT[] NOT NULL DEFAULT '{}';
