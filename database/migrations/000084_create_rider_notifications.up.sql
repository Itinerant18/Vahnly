-- Rider in-app notification feed. Rider domain migration 11/13.
CREATE TABLE IF NOT EXISTS rider_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_notifications_rider ON rider_notifications(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_notifications_is_read ON rider_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_rider_notifications_created_at ON rider_notifications(created_at);
