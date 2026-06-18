-- Scheduled bookings: a future-dated order is persisted (status CREATED, so it counts as
-- the rider's one active booking) but NOT published to order.created immediately. Its
-- dispatch payload is stored here verbatim (store-and-replay) and the dispatch scheduler
-- re-emits it ~lead-time before pickup. Storing the exact payload avoids re-deriving (and
-- re-pricing) the booking at dispatch time.
CREATE TABLE IF NOT EXISTS scheduled_dispatch_queue (
    order_id      UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    payload       JSONB NOT NULL,
    dispatched_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: the sweeper only ever scans undispatched rows ordered by due time.
CREATE INDEX IF NOT EXISTS idx_sched_dispatch_due
    ON scheduled_dispatch_queue (scheduled_at) WHERE dispatched_at IS NULL;
