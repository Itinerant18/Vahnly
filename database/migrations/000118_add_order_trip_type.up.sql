-- Persist the booking tier (trip_type) on the order so it can be rendered on
-- fetched orders (upcoming list + trip history). The value flows through the
-- booking request and dispatch event but was never saved on the row.
-- NULL for pre-migration rows; that is fine — the UI omits the chip when null.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS trip_type VARCHAR(30);
