-- Core structural ledger mapping immutable high-fidelity metadata metrics
CREATE TABLE trip_audit_summaries (
    order_id UUID PRIMARY KEY REFERENCES orders(id),
    driver_id UUID REFERENCES drivers(id) NOT NULL,
    
    -- Offer Lifecycles
    offer_received_at TIMESTAMP NOT NULL,
    offer_responded_at TIMESTAMP NOT NULL,
    offer_resolution VARCHAR(20) NOT NULL, -- 'ACCEPTED' | 'DECLINED' | 'TIMEOUT'
    decline_reason TEXT,
    response_latency_ms INT NOT NULL,
    
    -- Gated Ingress Metrics
    arrival_at TIMESTAMP,
    trip_started_at TIMESTAMP,
    trip_ended_at TIMESTAMP,
    total_wait_minutes INT DEFAULT 0,
    total_idle_minutes INT DEFAULT 0,
    total_route_deviation_meters INT DEFAULT 0,
    
    -- Verification Inputs
    start_odometer INT NOT NULL,
    end_odometer INT NOT NULL,
    start_fuel_percentage INT NOT NULL,
    end_fuel_percentage INT NOT NULL,
    otp_attempts_count INT DEFAULT 1,
    
    -- Payment Metadata
    payment_method VARCHAR(20) NOT NULL, -- 'CASH' | 'UPI' | 'WALLET' | 'CARD'
    payment_confirmed_at TIMESTAMP,
    
    -- Ratings Context
    rating_rider_stars INT CHECK (rating_rider_stars BETWEEN 1 AND 5),
    rating_driver_stars INT CHECK (rating_driver_stars BETWEEN 1 AND 5),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for rapid historic extraction routines
CREATE INDEX idx_trip_audit_summaries_driver ON trip_audit_summaries (driver_id, created_at DESC);
