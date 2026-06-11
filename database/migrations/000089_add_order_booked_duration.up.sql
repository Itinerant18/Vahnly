-- Booked duration for round-trip / outstation rider orders (extend-duration API).
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS booked_duration_hours INT;
