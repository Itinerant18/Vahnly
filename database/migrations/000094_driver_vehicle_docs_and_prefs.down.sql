DROP TABLE IF EXISTS vehicle_documents;
ALTER TABLE driver_vehicles
    DROP COLUMN IF EXISTS year,
    DROP COLUMN IF EXISTS fuel_type,
    DROP COLUMN IF EXISTS car_type;
ALTER TABLE drivers
    DROP COLUMN IF EXISTS notification_prefs,
    DROP COLUMN IF EXISTS preferred_language,
    DROP COLUMN IF EXISTS deleted_at;
