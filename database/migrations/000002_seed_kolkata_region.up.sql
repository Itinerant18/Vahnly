INSERT INTO regional_cities (city_prefix, city_name, is_active, geofence)
VALUES (
    'KOL',
    'Kolkata Urban Operations Grid',
    true,
    ST_GeographyFromText('SRID=4326;MULTIPOLYGON(((88.25 22.45, 88.45 22.45, 88.45 22.65, 88.25 22.65, 88.25 22.45)))')
) ON CONFLICT (city_prefix) DO NOTHING;

-- Seed an initial batch of available drivers to assist validation loops
INSERT INTO drivers (id, city_prefix, current_state, acceptance_rate, cancellation_probability, last_known_location)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01', 'KOL', 'ONLINE_AVAILABLE', 0.950, 0.010, ST_GeographyFromText('SRID=4326;POINT(88.3639 22.5726)')),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'KOL', 'ONLINE_AVAILABLE', 0.880, 0.040, ST_GeographyFromText('SRID=4326;POINT(88.3645 22.5731)')),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'KOL', 'ONLINE_AVAILABLE', 0.910, 0.020, ST_GeographyFromText('SRID=4326;POINT(88.3621 22.5712)'))
ON CONFLICT (id) DO NOTHING;
