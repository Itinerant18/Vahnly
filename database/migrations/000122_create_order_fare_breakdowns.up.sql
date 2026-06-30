-- Persisted per-order fare component breakdown so the admin trip detail shows the real
-- base / distance / night / total split (as the fare engine computed it at booking) rather
-- than a derived 40/50/10 guess. Written best-effort AFTER the order insert (never inside
-- the booking transaction), so a breakdown write can't fail a booking; absent rows fall
-- back to the derived split.
CREATE TABLE IF NOT EXISTS order_fare_breakdowns (
    order_id       UUID        PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    base_paise     BIGINT      NOT NULL DEFAULT 0,
    distance_paise BIGINT      NOT NULL DEFAULT 0,
    night_paise    BIGINT      NOT NULL DEFAULT 0,
    total_paise    BIGINT      NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
