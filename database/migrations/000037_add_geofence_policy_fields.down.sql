ALTER TABLE operational_geofences
DROP COLUMN IF EXISTS policy_type,
DROP COLUMN IF EXISTS surge_multiplier,
DROP COLUMN IF EXISTS allowed_transmissions,
DROP COLUMN IF EXISTS activation_start,
DROP COLUMN IF EXISTS activation_end,
DROP COLUMN IF EXISTS notes;
