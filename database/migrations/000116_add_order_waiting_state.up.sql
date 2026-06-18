-- B5: mid-trip WAITING state for round-trips. The driver can pause an active trip at the
-- destination (rider runs an errand); wait time accrues and is billed. Distinct from the
-- pickup wait (waiting_started_at), so it uses its own columns.
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'WAITING' AFTER 'DELIVERING';

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS accumulated_wait_seconds INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS wait_segment_started_at  TIMESTAMPTZ;
