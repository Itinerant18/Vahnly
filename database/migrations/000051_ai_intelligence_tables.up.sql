-- ── Fraud Detection ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_rules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name     VARCHAR(100) NOT NULL UNIQUE,
  fraud_type    VARCHAR(50)  NOT NULL,
  description   TEXT         NOT NULL DEFAULT '',
  threshold     NUMERIC(5,2) NOT NULL DEFAULT 70,
  weight        NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  action        VARCHAR(20)  NOT NULL DEFAULT 'FLAG',
  is_enabled    BOOLEAN      NOT NULL DEFAULT true,
  triggers_today INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  VARCHAR(20)  NOT NULL,
  entity_id    VARCHAR(100) NOT NULL,
  fraud_type   VARCHAR(50)  NOT NULL,
  score        NUMERIC(5,2) NOT NULL DEFAULT 0,
  evidence     JSONB        NOT NULL DEFAULT '{}',
  status       VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
  reviewed_by  UUID,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fraud_events_status     ON fraud_events(status);
CREATE INDEX idx_fraud_events_type       ON fraud_events(fraud_type);
CREATE INDEX idx_fraud_events_entity     ON fraud_events(entity_type, entity_id);

-- ── Demand Heatmap & Driver Positioning ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS demand_forecasts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  city             VARCHAR(10)  NOT NULL,
  zone_name        VARCHAR(100) NOT NULL,
  forecast_hour    TIMESTAMPTZ  NOT NULL,
  predicted_demand INT          NOT NULL DEFAULT 0,
  current_supply   INT          NOT NULL DEFAULT 0,
  surge_predicted  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  confidence_pct   INT          NOT NULL DEFAULT 85,
  UNIQUE(city, zone_name, forecast_hour)
);

CREATE INDEX idx_demand_forecasts_city_hour ON demand_forecasts(city, forecast_hour);

-- ── Voice of Customer ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voc_topics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           VARCHAR(200) NOT NULL,
  source          VARCHAR(30)  NOT NULL DEFAULT 'MIXED',
  mention_count   INT          NOT NULL DEFAULT 0,
  positive_count  INT          NOT NULL DEFAULT 0,
  negative_count  INT          NOT NULL DEFAULT 0,
  neutral_count   INT          NOT NULL DEFAULT 0,
  sentiment_score NUMERIC(4,2) NOT NULL DEFAULT 0,
  period_start    DATE         NOT NULL,
  period_end      DATE         NOT NULL,
  trending        BOOLEAN      NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voc_samples (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    UUID        NOT NULL REFERENCES voc_topics(id) ON DELETE CASCADE,
  entity_type VARCHAR(20)  NOT NULL,
  content     TEXT         NOT NULL,
  sentiment   VARCHAR(20)  NOT NULL DEFAULT 'NEUTRAL',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seeds: fraud rules
INSERT INTO fraud_rules (rule_name, fraud_type, description, threshold, weight, action, triggers_today) VALUES
('gps_speed_anomaly',   'GPS_SPOOFING',  'Speed >200 km/h between two consecutive pings',          80, 1.5, 'SUSPEND', 3),
('multi_device_login',  'MULTI_ACCOUNT', 'Same phone number logged in from >3 devices in 24h',     70, 1.2, 'FLAG',    7),
('promo_velocity',      'PROMO_ABUSE',   'Promo codes applied >5 times from same IP in 1 hour',    75, 1.0, 'BLOCK',   2),
('fake_trip_distance',  'FAKE_TRIP',     'Trip distance >30% off route polyline',                  65, 1.0, 'FLAG',    1),
('refund_velocity',     'PAYMENT_FRAUD', 'More than 3 successful refunds in 7 days per account',   60, 0.8, 'FLAG',    4);

-- Seeds: fraud events
INSERT INTO fraud_events (entity_type, entity_id, fraud_type, score, evidence, status) VALUES
('DRIVER', 'drv-001', 'GPS_SPOOFING',  88.5, '{"speed_kmph":340,"ping_gap_sec":12,"city":"KOL"}',          'OPEN'),
('RIDER',  'usr-002', 'PROMO_ABUSE',   76.0, '{"promo_code":"FIRST50","uses":7,"ip":"203.122.1.44"}',       'CONFIRMED'),
('DRIVER', 'drv-003', 'MULTI_ACCOUNT', 72.3, '{"device_count":4,"phone":"+919876543210"}',                  'OPEN'),
('RIDER',  'usr-004', 'PAYMENT_FRAUD', 65.1, '{"refund_count":4,"total_paise":84000}',                      'DISMISSED'),
('DRIVER', 'drv-005', 'FAKE_TRIP',     81.2, '{"declared_km":18.4,"polyline_km":9.1,"deviation_pct":50.5}', 'OPEN');

-- Seeds: demand forecasts
INSERT INTO demand_forecasts (city, zone_name, forecast_hour, predicted_demand, current_supply, surge_predicted, confidence_pct) VALUES
('KOL', 'Park Street',     NOW() + INTERVAL '1 hour',  120, 45, 2.1, 88),
('KOL', 'Salt Lake Sec V', NOW() + INTERVAL '1 hour',  95,  60, 1.4, 91),
('KOL', 'Howrah Station',  NOW() + INTERVAL '2 hours', 200, 30, 3.0, 85),
('KOL', 'Airport Zone',    NOW() + INTERVAL '2 hours', 80,  55, 1.2, 93),
('BLR', 'Koramangala',     NOW() + INTERVAL '1 hour',  150, 70, 1.8, 87),
('BLR', 'Whitefield',      NOW() + INTERVAL '2 hours', 110, 40, 2.4, 82),
('BLR', 'MG Road',         NOW() + INTERVAL '3 hours', 90,  80, 1.1, 95);

-- Seeds: VoC topics + samples
WITH t1 AS (INSERT INTO voc_topics (topic, source, mention_count, positive_count, negative_count, neutral_count, sentiment_score, period_start, period_end, trending)
  VALUES ('Long wait times', 'TICKETS', 142, 8, 118, 16, -0.78, CURRENT_DATE - 30, CURRENT_DATE, true) RETURNING id)
INSERT INTO voc_samples (topic_id, entity_type, content, sentiment) SELECT id, 'TICKET', 'Driver took 18 minutes even though it showed 4 min ETA', 'NEGATIVE' FROM t1;

WITH t2 AS (INSERT INTO voc_topics (topic, source, mention_count, positive_count, negative_count, neutral_count, sentiment_score, period_start, period_end, trending)
  VALUES ('Driver professionalism', 'REVIEWS', 98, 82, 6, 10, 0.77, CURRENT_DATE - 30, CURRENT_DATE, false) RETURNING id)
INSERT INTO voc_samples (topic_id, entity_type, content, sentiment) SELECT id, 'REVIEW', 'Driver was very polite and helped with luggage. Great experience.', 'POSITIVE' FROM t2;

WITH t3 AS (INSERT INTO voc_topics (topic, source, mention_count, positive_count, negative_count, neutral_count, sentiment_score, period_start, period_end, trending)
  VALUES ('App crashes on booking', 'TICKETS', 67, 0, 67, 0, -1.0, CURRENT_DATE - 30, CURRENT_DATE, true) RETURNING id)
INSERT INTO voc_samples (topic_id, entity_type, content, sentiment) SELECT id, 'TICKET', 'App crashes every time I tap confirm booking on Android 13', 'NEGATIVE' FROM t3;
