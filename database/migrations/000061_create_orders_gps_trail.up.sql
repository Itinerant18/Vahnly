-- Create orders_gps_trail table to record high-frequency 5s GPS location updates
CREATE TABLE IF NOT EXISTS orders_gps_trail (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    captured_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_gps_trail_order_id ON orders_gps_trail(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_gps_trail_captured ON orders_gps_trail(captured_at);

-- Create order_events table to record mid-trip mutations (like tolls or extra stops)
CREATE TABLE IF NOT EXISTS order_events (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type   VARCHAR(30)  NOT NULL, -- 'ADD_TOLL', 'ADD_STOP'
    amount_paise BIGINT       NOT NULL DEFAULT 0,
    description  TEXT         NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
