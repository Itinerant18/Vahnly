-- Track realtime SOS state updates for fast regional scanning
CREATE TABLE driver_sos_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id) NOT NULL,
    current_order_id UUID REFERENCES orders(id),
    latitude DECIMAL(9,6) NOT NULL,
    longitude DECIMAL(9,6) NOT NULL,
    resolved_at TIMESTAMP,
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sos_alerts_active ON driver_sos_alerts (created_at) WHERE resolved_at IS NULL;

-- Log continuous activity periods to enforce regional fatigue resets
CREATE TABLE driver_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID REFERENCES drivers(id) NOT NULL,
    online_started_at TIMESTAMP NOT NULL,
    offline_ended_at TIMESTAMP,
    cumulative_active_seconds INT DEFAULT 0,
    is_force_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_driver_shifts_active ON driver_shifts (driver_id) WHERE offline_ended_at IS NULL;
