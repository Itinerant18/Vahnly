-- Package (duration-based) bookings (B4). package_type selects the rate-card pricing model;
-- NULL means the legacy distance-metered point-to-point fare. duration is reused from the
-- existing booked_duration_hours column.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS package_type VARCHAR(20)
        CHECK (package_type IN ('HOURLY', 'MINI_OUTSTATION', 'OUTSTATION', 'MONTHLY'));
