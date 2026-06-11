-- Restore NOT NULL. Rows with a NULL trip_id must be backfilled or removed first,
-- or this will fail.
ALTER TABLE safety_sos_alerts ALTER COLUMN trip_id SET NOT NULL;
