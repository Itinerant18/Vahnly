-- Postgres can't drop an enum value, so only the columns are reverted; 'WAITING' stays on
-- order_status_enum (harmless if unused).
ALTER TABLE orders
    DROP COLUMN IF EXISTS accumulated_wait_seconds,
    DROP COLUMN IF EXISTS wait_segment_started_at;
