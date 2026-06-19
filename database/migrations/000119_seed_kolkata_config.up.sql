-- Kolkata launch config: make the KOL operating hours + supported tiers explicit
-- on the regional_cities row (previously NULL, served by the FE/endpoint fallback).
-- Values match the fallback (6 AM to 11 PM, all tiers); this just makes them
-- authoritative so the booking sheet reflects real city config, not a default.
UPDATE regional_cities
SET operating_hours_start = TIME '06:00',
    operating_hours_end   = TIME '23:00',
    supported_trip_types  = ARRAY['IN_CITY_ONE_WAY', 'IN_CITY_ROUND', 'IN_CITY_HOURLY', 'MINI_OUTSTATION', 'OUTSTATION', 'MONTHLY']
WHERE city_prefix = 'KOL';
