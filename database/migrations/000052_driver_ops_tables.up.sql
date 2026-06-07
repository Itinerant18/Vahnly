-- ── Dynamic Driver Incentives ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_campaigns (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(200)  NOT NULL,
  trigger_type     VARCHAR(50)   NOT NULL,
  condition_config JSONB         NOT NULL DEFAULT '{}',
  reward_type      VARCHAR(30)   NOT NULL DEFAULT 'FIXED',
  reward_value     INT           NOT NULL DEFAULT 0,
  target_cities    TEXT[]        NOT NULL DEFAULT '{}',
  starts_at        TIMESTAMPTZ   NOT NULL,
  ends_at          TIMESTAMPTZ   NOT NULL,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  drivers_targeted INT           NOT NULL DEFAULT 0,
  drivers_claimed  INT           NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incentive_offers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID        NOT NULL,
  campaign_id UUID        NOT NULL REFERENCES incentive_campaigns(id) ON DELETE CASCADE,
  status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  offered_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  claimed_at  TIMESTAMPTZ
);

-- ── Driver Coaching ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_flags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   VARCHAR(100) NOT NULL,
  trip_id     VARCHAR(100),
  flag_type   VARCHAR(50)  NOT NULL,
  severity    VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',
  details     JSONB        NOT NULL DEFAULT '{}',
  is_resolved BOOLEAN      NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_modules (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(200)  NOT NULL,
  category     VARCHAR(50)   NOT NULL,
  content_url  VARCHAR(500)  NOT NULL DEFAULT '',
  duration_mins INT          NOT NULL DEFAULT 15,
  is_mandatory BOOLEAN       NOT NULL DEFAULT false,
  pass_score   INT           NOT NULL DEFAULT 70,
  is_active    BOOLEAN       NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_training (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    VARCHAR(100)  NOT NULL,
  module_id    UUID          NOT NULL REFERENCES training_modules(id),
  status       VARCHAR(20)   NOT NULL DEFAULT 'ASSIGNED',
  assigned_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  score        INT,
  UNIQUE(driver_id, module_id)
);

-- ── Vehicle Inspection ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      VARCHAR(100)  NOT NULL,
  vehicle_plate  VARCHAR(20)   NOT NULL,
  status         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  due_date       DATE          NOT NULL,
  submitted_at   TIMESTAMPTZ,
  reviewed_at    TIMESTAMPTZ,
  overall_score  INT,
  notes          TEXT          NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID          NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  item_name     VARCHAR(100)  NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  photo_url     VARCHAR(500)  NOT NULL DEFAULT '',
  notes         VARCHAR(500)  NOT NULL DEFAULT ''
);

-- ── In-house Telematics ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telematics_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   VARCHAR(100)  NOT NULL,
  trip_id     VARCHAR(100),
  event_type  VARCHAR(50)   NOT NULL,
  severity    VARCHAR(20)   NOT NULL DEFAULT 'MEDIUM',
  speed_kmph  NUMERIC(6,2),
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  occurred_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telematics_driver ON telematics_events(driver_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS driver_telematics_summary (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           VARCHAR(100)  NOT NULL,
  period_date         DATE          NOT NULL,
  total_distance_km   NUMERIC(8,2)  NOT NULL DEFAULT 0,
  harsh_braking_count INT           NOT NULL DEFAULT 0,
  speeding_count      INT           NOT NULL DEFAULT 0,
  sharp_turn_count    INT           NOT NULL DEFAULT 0,
  phone_usage_count   INT           NOT NULL DEFAULT 0,
  safety_score        INT           NOT NULL DEFAULT 100,
  UNIQUE(driver_id, period_date)
);

-- Seeds
INSERT INTO incentive_campaigns (name, trigger_type, condition_config, reward_type, reward_value, target_cities, starts_at, ends_at, is_active, drivers_targeted, drivers_claimed) VALUES
('Peak Hour Bonus — Kolkata',  'PEAK_HOUR',  '{"hour_start":8,"hour_end":10,"min_trips":3}',  'FIXED',   5000,  ARRAY['KOL'], NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', true, 340, 112),
('Supply Booster — Bangalore', 'LOW_SUPPLY', '{"supply_threshold":50,"zone":"Whitefield"}',   'BONUS_TRIPS', 3, ARRAY['BLR'], NOW() - INTERVAL '1 day',  NOW() + INTERVAL '6 days', true, 180, 67),
('Rain Surge Incentive',       'MANUAL',     '{"reason":"Heavy rain forecast weekend"}',       'PERCENT', 20,    ARRAY['KOL','BLR'], NOW(), NOW() + INTERVAL '2 days', false, 0, 0);

INSERT INTO coaching_flags (driver_id, flag_type, severity, details) VALUES
('drv-001', 'LOW_RATING',        'HIGH',   '{"rating":3.6,"threshold":4.0,"trip_count":12}'),
('drv-002', 'CANCELLATION_RATE', 'HIGH',   '{"cancel_pct":28,"threshold":15,"period":"7d"}'),
('drv-003', 'COMPLAINT',         'MEDIUM', '{"ticket_id":"TKT-4421","category":"rude_behavior"}'),
('drv-004', 'ROUTE_DEVIATION',   'LOW',    '{"deviation_pct":18,"trip_id":"ORD-KOL-009"}'),
('drv-005', 'SPEEDING',          'HIGH',   '{"max_speed_kmph":98,"limit_kmph":60,"event_count":3}');

INSERT INTO training_modules (title, category, duration_mins, is_mandatory, pass_score, is_active) VALUES
('Defensive Driving Fundamentals',   'SAFETY',           30, true,  80, true),
('Customer Service Excellence',      'CUSTOMER_SERVICE', 20, true,  70, true),
('Route Optimization & Navigation',  'ROUTE_OPTIMIZATION', 15, false, 65, true),
('DPDP & Data Privacy Basics',       'COMPLIANCE',       25, true,  75, true),
('First Aid & Emergency Response',   'SAFETY',           45, false, 70, true);

INSERT INTO vehicle_inspections (driver_id, vehicle_plate, status, due_date, submitted_at, overall_score) VALUES
('drv-001', 'WB-02-AK-9988', 'APPROVED',  CURRENT_DATE - 10, NOW() - INTERVAL '12 days', 92),
('drv-002', 'KA-05-MN-3344', 'REJECTED',  CURRENT_DATE - 5,  NOW() - INTERVAL '6 days',  41),
('drv-003', 'WB-10-CD-5566', 'PENDING',   CURRENT_DATE + 3,  NULL,                        NULL),
('drv-004', 'DL-01-EF-7788', 'SUBMITTED', CURRENT_DATE + 1,  NOW() - INTERVAL '1 day',   NULL),
('drv-005', 'MH-12-GH-2233', 'OVERDUE',   CURRENT_DATE - 7,  NULL,                        NULL);

INSERT INTO telematics_events (driver_id, trip_id, event_type, severity, speed_kmph, lat, lng) VALUES
('drv-001', 'ORD-001', 'HARSH_BRAKING', 'HIGH',   72.4, 22.5726, 88.3639),
('drv-002', 'ORD-002', 'SPEEDING',      'HIGH',   98.2, 22.5448, 88.3426),
('drv-003', 'ORD-003', 'SHARP_TURN',   'MEDIUM', 55.0, 12.9716, 77.5946),
('drv-004', 'ORD-004', 'PHONE_USAGE',  'LOW',    30.0, 22.5802, 88.4262),
('drv-005', 'ORD-005', 'SPEEDING',     'HIGH',   110.5, 12.9352, 77.6245);

INSERT INTO driver_telematics_summary (driver_id, period_date, total_distance_km, harsh_braking_count, speeding_count, sharp_turn_count, phone_usage_count, safety_score) VALUES
('drv-001', CURRENT_DATE, 142.3, 4, 2, 3, 1, 72),
('drv-002', CURRENT_DATE, 98.7,  1, 5, 2, 0, 61),
('drv-003', CURRENT_DATE, 210.1, 0, 0, 1, 0, 98),
('drv-004', CURRENT_DATE, 76.5,  2, 1, 0, 3, 80),
('drv-005', CURRENT_DATE, 188.9, 6, 7, 4, 2, 48);
