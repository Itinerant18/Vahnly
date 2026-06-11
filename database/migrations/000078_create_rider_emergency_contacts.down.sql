DROP TRIGGER IF EXISTS trg_max_emergency_contacts ON rider_emergency_contacts;
DROP FUNCTION IF EXISTS enforce_max_emergency_contacts();
DROP TABLE IF EXISTS rider_emergency_contacts;
