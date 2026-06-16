-- Per-rider notification channel preferences (push/SMS/email per category).
-- Stored as a single JSONB blob so categories can evolve without schema churn.
CREATE TABLE IF NOT EXISTS rider_notification_preferences (
    rider_id    UUID PRIMARY KEY REFERENCES riders(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
