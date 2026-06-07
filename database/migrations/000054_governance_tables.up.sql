-- ── Carbon & ESG Reporting ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emission_factors (
  vehicle_type    VARCHAR(50)  PRIMARY KEY,
  co2_kg_per_km   NUMERIC(6,4) NOT NULL,
  description     VARCHAR(200) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS carbon_records (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        VARCHAR(100),
  vehicle_type   VARCHAR(50)  NOT NULL DEFAULT 'PETROL_CAR',
  distance_km    NUMERIC(8,3) NOT NULL DEFAULT 0,
  emission_kg    NUMERIC(8,4) NOT NULL DEFAULT 0,
  offset_kg      NUMERIC(8,4) NOT NULL DEFAULT 0,
  recorded_date  DATE         NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS esg_reports (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  period             VARCHAR(20)   NOT NULL UNIQUE,
  total_trips        INT           NOT NULL DEFAULT 0,
  total_distance_km  NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_emission_kg  NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_offset_kg    NUMERIC(12,4) NOT NULL DEFAULT 0,
  net_emission_kg    NUMERIC(12,4) NOT NULL DEFAULT 0,
  ev_trip_pct        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  women_driver_pct   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  status             VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
  metrics            JSONB         NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Multi-tenant / Franchise Mode ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  plan            VARCHAR(30)  NOT NULL DEFAULT 'STANDARD',
  contact_email   VARCHAR(200) NOT NULL,
  contact_phone   VARCHAR(20)  NOT NULL DEFAULT '',
  cities          TEXT[]       NOT NULL DEFAULT '{}',
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  credit_limit_paise INT       NOT NULL DEFAULT 0,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  config          JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_operators (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  email         VARCHAR(200) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'OPERATOR',
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- Seeds: emission factors
INSERT INTO emission_factors (vehicle_type, co2_kg_per_km, description) VALUES
('PETROL_CAR',   0.1710, 'Standard petrol sedan/hatchback'),
('DIESEL_CAR',   0.1680, 'Standard diesel sedan'),
('CNG_CAR',      0.1100, 'CNG-powered vehicle'),
('ELECTRIC_CAR', 0.0410, 'Battery EV (India grid average)'),
('BIKE',         0.0830, 'Two-wheeler petrol'),
('AUTO',         0.0960, 'CNG autorickshaw');

-- Seeds: carbon records
INSERT INTO carbon_records (trip_id, vehicle_type, distance_km, emission_kg, offset_kg, recorded_date) VALUES
('ORD-KOL-001', 'PETROL_CAR',   12.4, 2.1204, 0,      CURRENT_DATE),
('ORD-KOL-002', 'ELECTRIC_CAR', 8.7,  0.3567, 0.3567, CURRENT_DATE),
('ORD-BLR-001', 'CNG_CAR',      15.2, 1.6720, 0,      CURRENT_DATE),
('ORD-BLR-002', 'DIESEL_CAR',   22.1, 3.7128, 0,      CURRENT_DATE - 1),
('ORD-KOL-003', 'ELECTRIC_CAR', 6.3,  0.2583, 0.2583, CURRENT_DATE - 1);

-- Seeds: ESG reports
INSERT INTO esg_reports (period, total_trips, total_distance_km, total_emission_kg, total_offset_kg, net_emission_kg, ev_trip_pct, women_driver_pct, status, metrics) VALUES
('2026-05', 284710, 2847100.0, 513272.1, 4200.5, 509071.6, 4.2, 8.1, 'PUBLISHED',
 '{"trees_equivalent":23140,"grievances_resolved_pct":94.2,"avg_driver_earning_paise":82400,"fuel_saved_liters":1240}'),
('2026-06', 97340,  973400.0,  175803.4, 1600.2, 174203.2, 5.1, 8.9, 'DRAFT',
 '{"trees_equivalent":7900,"grievances_resolved_pct":95.8,"avg_driver_earning_paise":84100,"fuel_saved_liters":430}');

-- Seeds: tenants
INSERT INTO tenants (name, slug, plan, contact_email, contact_phone, cities, commission_pct, is_active, config) VALUES
('RideEasy Kolkata',    'rideeasy-kol',   'PREMIUM',    'ops@rideeasy.in',    '+91-9800000001', ARRAY['KOL'],        18.5, true, '{"brand_color":"#1a73e8","whitelabel":true}'),
('FastWheels Bangalore','fastwheels-blr', 'ENTERPRISE', 'admin@fastwheels.io', '+91-9900000002', ARRAY['BLR','MYS'], 17.0, true, '{"brand_color":"#ff6600","whitelabel":true,"sso_provider":"google"}'),
('CityRides Pune',      'cityrides-pun',  'STANDARD',   'info@cityrides.co',  '+91-9700000003', ARRAY['PUN'],        20.0, false,'{"brand_color":"#2d6a4f","whitelabel":false}');

INSERT INTO tenant_operators (tenant_id, name, email, role, is_active, last_login_at)
SELECT id, 'Priya Sharma',  'priya@rideeasy.in',   'ADMIN',    true, NOW() - INTERVAL '2 hours' FROM tenants WHERE slug = 'rideeasy-kol'
UNION ALL
SELECT id, 'Rajan Menon',   'rajan@rideeasy.in',   'OPERATOR', true, NOW() - INTERVAL '1 day'   FROM tenants WHERE slug = 'rideeasy-kol'
UNION ALL
SELECT id, 'Arun Kumar',    'arun@fastwheels.io',  'ADMIN',    true, NOW() - INTERVAL '3 hours' FROM tenants WHERE slug = 'fastwheels-blr'
UNION ALL
SELECT id, 'Meera Pillai',  'meera@fastwheels.io', 'READ_ONLY',true, NOW() - INTERVAL '5 days'  FROM tenants WHERE slug = 'fastwheels-blr';
