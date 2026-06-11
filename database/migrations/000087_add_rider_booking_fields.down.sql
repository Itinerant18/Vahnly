ALTER TABLE orders
    DROP COLUMN IF EXISTS scheduled_at,
    DROP COLUMN IF EXISTS persons_count,
    DROP COLUMN IF EXISTS rider_stops;
