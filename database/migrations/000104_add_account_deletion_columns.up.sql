-- DPDP (Digital Personal Data Protection Act) right-to-erasure support.
-- deleted_at records when a rider/driver exercised erasure. The row is RETAINED but
-- its direct identifiers are scrubbed; financial/tax/trip records are kept for the
-- statutory retention window and continue to reference the now-anonymized row.
-- Drivers also move to account_status='DELETED' (column added in 000093).
ALTER TABLE riders  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
