-- Booking fields the rider order flow needs that the orders table did not yet carry.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS persons_count SMALLINT,
    ADD COLUMN IF NOT EXISTS rider_stops JSONB;
