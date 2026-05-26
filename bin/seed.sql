DELETE FROM dispatch_match_logs WHERE order_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
DELETE FROM orders WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
DELETE FROM drivers WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
DELETE FROM regional_cities WHERE city_prefix = 'KOL';

INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active, geofence)
VALUES (
    'KOL',
    'Kolkata',
    'Asia/Kolkata',
    true,
    ST_GeomFromText('MULTIPOLYGON(((88.3 22.5, 88.4 22.5, 88.4 22.6, 88.3 22.6, 88.3 22.5)))', 4326)::geography
);

INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, acceptance_rate, cancellation_rate)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'KOL',
    'Subir Das',
    '+919876543210',
    'DL-12345-KOL',
    'ONLINE_AVAILABLE',
    true,
    0.950,
    0.010
);

INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, surge_multiplier, base_fare_paise)
VALUES (
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    'KOL',
    'c81d4e2e-bcf2-11e6-869b-7df243852131',
    'CREATED',
    ST_GeomFromText('POINT(88.3639 22.5726)', 4326)::geography,
    ST_GeomFromText('POINT(88.3700 22.5800)', 4326)::geography,
    '88283473fffffff',
    1.00,
    35000
);
