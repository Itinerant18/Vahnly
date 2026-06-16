-- Driver self-described bio shown on the profile/performance screens and editable
-- via PATCH /api/v1/driver/profile. Additive only; safe to re-run.
ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS bio TEXT;
