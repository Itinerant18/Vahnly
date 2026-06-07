-- Trip odometer / fuel checkpoints captured by the driver app at trip START and END.
-- Kept in a dedicated table (not bloating orders) so the mileage audit trail is
-- immutable and independently extensible (e.g. OCR logs on the photos later).
-- Convention: VARCHAR + CHECK rather than a CREATE TYPE enum, matching the newer
-- tables in this schema and keeping the down-migration a simple DROP TABLE.
CREATE TABLE IF NOT EXISTS trip_odometer_checkpoints (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    checkpoint_type VARCHAR(10)  NOT NULL CHECK (checkpoint_type IN ('START', 'END')),
    odometer_value  INT          NOT NULL,                                   -- absolute km on the dashboard
    fuel_percentage INT          NOT NULL DEFAULT 0 CHECK (fuel_percentage BETWEEN 0 AND 100),
    photo_url       TEXT         NOT NULL DEFAULT '',
    captured_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      UUID,                                                    -- driver_id (mocked until the driver app posts these)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, checkpoint_type)                                       -- one START and one END per trip
);

CREATE INDEX IF NOT EXISTS idx_odometer_order_id ON trip_odometer_checkpoints(order_id);

-- Seed START/END checkpoints against a few existing orders so the audit UI has
-- representative data. END = START + ~road-distance (1.3x straight-line); the most
-- recent order gets an inflated END to demonstrate a flagged (>15%) variance.
WITH picked AS (
    SELECT id,
           GREATEST(ROUND(ST_Distance(pickup_location, dropoff_location) / 1000.0 * 1.3)::int, 1) AS route_km,
           row_number() OVER (ORDER BY created_at DESC) AS rn
    FROM orders
    LIMIT 4
)
INSERT INTO trip_odometer_checkpoints (order_id, checkpoint_type, odometer_value, fuel_percentage, photo_url, captured_at)
SELECT id, 'START', 50000 + (rn * 1000), 82,
       'https://cdn.drivers-for-u.in/odo/' || id || '-start.jpg', NOW() - INTERVAL '2 hours'
FROM picked
UNION ALL
SELECT id, 'END',
       CASE WHEN rn = 1
            THEN 50000 + (rn * 1000) + route_km + 45   -- inflated -> flagged variance
            ELSE 50000 + (rn * 1000) + route_km END,
       58,
       'https://cdn.drivers-for-u.in/odo/' || id || '-end.jpg', NOW() - INTERVAL '1 hour'
FROM picked;
