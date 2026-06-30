-- Hourly platform KPI snapshots so the admin dashboard can compute real trend deltas
-- (active-trips / online-drivers change vs the prior hour) instead of fabricated magic
-- offsets. Written by the gateway's KPI snapshot worker; read by HandleGetDashboardKPIs.
CREATE TABLE IF NOT EXISTS kpi_snapshots (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_trips   BIGINT      NOT NULL DEFAULT 0,
    online_drivers BIGINT      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_captured_at ON kpi_snapshots (captured_at DESC);
