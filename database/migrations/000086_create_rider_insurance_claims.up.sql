-- D4M Care insurance claims raised against a trip. Rider domain migration 13/13.
CREATE TABLE IF NOT EXISTS rider_insurance_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    rider_id UUID NOT NULL REFERENCES riders(id),
    claim_type VARCHAR(50),
    description TEXT,
    status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','APPROVED','REJECTED','CLOSED')),
    d4m_claim_reference VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_insurance_claims_order ON rider_insurance_claims(order_id);
CREATE INDEX IF NOT EXISTS idx_rider_insurance_claims_rider ON rider_insurance_claims(rider_id);
