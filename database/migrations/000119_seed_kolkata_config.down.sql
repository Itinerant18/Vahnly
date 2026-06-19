UPDATE regional_cities
SET operating_hours_start = NULL, operating_hours_end = NULL, supported_trip_types = NULL
WHERE city_prefix = 'KOL';
