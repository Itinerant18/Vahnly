-- A driver-initiated SOS may have no active trip (e.g. between rides). The handler
-- previously attached the alert to a random order (SELECT id FROM orders LIMIT 1)
-- just to satisfy this NOT NULL foreign key, corrupting incident attribution.
-- Allow NULL so a standalone SOS can be filed without a bogus trip reference.
ALTER TABLE safety_sos_alerts ALTER COLUMN trip_id DROP NOT NULL;
