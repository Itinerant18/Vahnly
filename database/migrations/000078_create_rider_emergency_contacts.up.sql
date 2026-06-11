-- Rider emergency contacts, max 3 per rider (enforced via trigger). Rider domain migration 5/13.
CREATE TABLE IF NOT EXISTS rider_emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) NOT NULL,
    relationship VARCHAR(50),
    auto_share_trip BOOLEAN DEFAULT false,
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_emergency_contacts_rider ON rider_emergency_contacts(rider_id);

-- A row-count cap cannot be expressed as a CHECK constraint, so enforce it with a BEFORE INSERT trigger.
CREATE OR REPLACE FUNCTION enforce_max_emergency_contacts()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM rider_emergency_contacts WHERE rider_id = NEW.rider_id) >= 3 THEN
        RAISE EXCEPTION 'rider % already has the maximum of 3 emergency contacts', NEW.rider_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_max_emergency_contacts
    BEFORE INSERT ON rider_emergency_contacts
    FOR EACH ROW
    EXECUTE FUNCTION enforce_max_emergency_contacts();
