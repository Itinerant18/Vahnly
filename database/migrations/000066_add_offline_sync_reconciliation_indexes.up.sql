-- Ensure telemetry table handles historical device back-filling without clobbering live records
ALTER TABLE orders_gps_trail 
ADD COLUMN client_captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN is_synced_offline BOOLEAN DEFAULT FALSE;

-- Composite indexing for late-arriving batch reconciliation engines
CREATE INDEX idx_gps_trail_sync_reconcile 
ON orders_gps_trail (order_id, client_captured_at DESC);

-- Track offline batch execution headers to detect data tampering or manipulation
CREATE TABLE driver_offline_sync_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id) NOT NULL,
    session_started_at TIMESTAMP NOT NULL,
    sync_completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_packets_processed INT DEFAULT 0,
    device_fingerprint TEXT NOT NULL
);
