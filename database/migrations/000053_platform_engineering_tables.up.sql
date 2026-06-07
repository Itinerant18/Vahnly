-- ── Service Health ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_health_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name      VARCHAR(100) NOT NULL,
  uptime_pct        NUMERIC(6,3) NOT NULL DEFAULT 100,
  error_rate_pct    NUMERIC(6,3) NOT NULL DEFAULT 0,
  p50_latency_ms    INT          NOT NULL DEFAULT 0,
  p95_latency_ms    INT          NOT NULL DEFAULT 0,
  p99_latency_ms    INT          NOT NULL DEFAULT 0,
  requests_per_min  INT          NOT NULL DEFAULT 0,
  recorded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_svc_health_name_time ON service_health_snapshots(service_name, recorded_at DESC);

CREATE TABLE IF NOT EXISTS health_incidents (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name       VARCHAR(100) NOT NULL,
  title              VARCHAR(500) NOT NULL,
  severity           VARCHAR(20)  NOT NULL DEFAULT 'HIGH',
  status             VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
  impact_description TEXT         NOT NULL DEFAULT '',
  started_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ,
  root_cause         TEXT         NOT NULL DEFAULT ''
);

-- ── Experimentation Platform ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200)  NOT NULL UNIQUE,
  description    TEXT          NOT NULL DEFAULT '',
  hypothesis     TEXT          NOT NULL DEFAULT '',
  metric         VARCHAR(100)  NOT NULL,
  status         VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
  variants       JSONB         NOT NULL DEFAULT '[]',
  target_cities  TEXT[]        NOT NULL DEFAULT '{}',
  start_date     DATE,
  end_date       DATE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiment_results (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id     UUID          NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_name      VARCHAR(100)  NOT NULL,
  sample_size       INT           NOT NULL DEFAULT 0,
  conversion_rate   NUMERIC(6,4)  NOT NULL DEFAULT 0,
  avg_metric_value  NUMERIC(12,4) NOT NULL DEFAULT 0,
  p_value           NUMERIC(8,6),
  is_winner         BOOLEAN       NOT NULL DEFAULT false,
  recorded_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Chatbot L1 Support ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_intents (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_name           VARCHAR(100)  NOT NULL UNIQUE,
  example_phrases       TEXT[]        NOT NULL DEFAULT '{}',
  response_template     TEXT          NOT NULL,
  confidence_threshold  NUMERIC(4,2)  NOT NULL DEFAULT 0.75,
  fallback_to_human     BOOLEAN       NOT NULL DEFAULT false,
  trigger_count         INT           NOT NULL DEFAULT 0,
  is_active             BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type     VARCHAR(20)  NOT NULL,
  user_id       VARCHAR(100) NOT NULL,
  channel       VARCHAR(20)  NOT NULL DEFAULT 'APP',
  status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  message_count INT          NOT NULL DEFAULT 0,
  deflected     BOOLEAN      NOT NULL DEFAULT true,
  escalated_at  TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seeds: health snapshots
INSERT INTO service_health_snapshots (service_name, uptime_pct, error_rate_pct, p50_latency_ms, p95_latency_ms, p99_latency_ms, requests_per_min) VALUES
('api-gateway',     99.98, 0.12, 42,  180, 520,  2840),
('dispatch-engine', 99.95, 0.28, 18,  95,  220,  430),
('pricing-service', 99.99, 0.04, 8,   35,  90,   1200),
('payment-gateway', 99.80, 1.20, 120, 890, 2100, 340),
('notification-svc',99.90, 0.40, 55,  310, 850,  780),
('maps-service',    99.97, 0.08, 95,  420, 1100, 1560),
('auth-service',    100.0, 0.01, 12,  55,  120,  620);

-- Seeds: health incidents
INSERT INTO health_incidents (service_name, title, severity, status, impact_description, started_at, root_cause) VALUES
('payment-gateway', 'Razorpay webhook delays causing payment confirmation lag',
 'HIGH', 'RESOLVED', '~340 rides/hour affected, riders unable to confirm payment for 22 min',
 NOW() - INTERVAL '3 days', 'Razorpay webhook retry queue backed up due to expired SSL cert on callback URL'),
('dispatch-engine', 'Dispatch latency spike in Kolkata zone',
 'MEDIUM', 'OPEN', 'Driver-match latency increased from 18ms to 450ms for KOL cluster',
 NOW() - INTERVAL '2 hours', '');

-- Seeds: experiments
WITH exp1 AS (
  INSERT INTO experiments (name, description, hypothesis, metric, status, variants, target_cities, start_date, end_date)
  VALUES (
    'upfront_pricing_v2',
    'Test showing full upfront price vs estimated range at booking',
    'Showing upfront price increases conversion by reducing abandonment anxiety',
    'booking_conversion_rate',
    'RUNNING',
    '[{"name":"control","description":"Estimated range (current)","split_pct":50},{"name":"treatment","description":"Exact upfront price","split_pct":50}]',
    ARRAY['KOL'],
    CURRENT_DATE - 14,
    CURRENT_DATE + 16
  ) RETURNING id
)
INSERT INTO experiment_results (experiment_id, variant_name, sample_size, conversion_rate, avg_metric_value, p_value, is_winner)
SELECT id, 'control',   8430, 0.6234, 62.34, 0.032, false FROM exp1
UNION ALL
SELECT id, 'treatment', 8217, 0.6891, 68.91, 0.032, true  FROM exp1;

WITH exp2 AS (
  INSERT INTO experiments (name, description, hypothesis, metric, status, variants, target_cities, start_date, end_date)
  VALUES (
    'cancel_fee_nudge',
    'Show cancellation fee warning 30s after driver is assigned',
    'Nudge reduces post-acceptance cancellations by 20%',
    'cancellation_rate_post_accept',
    'CONCLUDED',
    '[{"name":"control","description":"No nudge","split_pct":50},{"name":"treatment","description":"Fee warning popup","split_pct":50}]',
    ARRAY['KOL','BLR'],
    CURRENT_DATE - 45,
    CURRENT_DATE - 15
  ) RETURNING id
)
INSERT INTO experiment_results (experiment_id, variant_name, sample_size, conversion_rate, avg_metric_value, p_value, is_winner)
SELECT id, 'control',   15200, 0.089, 8.9, 0.001, false FROM exp2
UNION ALL
SELECT id, 'treatment', 15450, 0.062, 6.2, 0.001, true  FROM exp2;

-- Seeds: chatbot intents
INSERT INTO chatbot_intents (intent_name, example_phrases, response_template, confidence_threshold, fallback_to_human, trigger_count, is_active) VALUES
('trip_cancellation',   ARRAY['cancel my ride','how to cancel','i want to cancel'],       'To cancel your ride, tap the "Cancel" button on the trip screen. Note: cancellations after driver acceptance may incur a fee.',             0.80, false, 1240, true),
('refund_status',       ARRAY['refund status','when will i get refund','my money back'],   'Refunds are processed within 5-7 business days to your original payment method. Your refund ID is available in the app under Trips.',       0.75, false, 880,  true),
('driver_not_arriving', ARRAY['driver not coming','driver is late','no driver'],           'We''re looking into this for you. You can track the driver in real time on the map. If they''re not moving, please tap "I have a problem".',  0.78, true,  640,  true),
('promo_not_applied',   ARRAY['promo not working','coupon not applied','discount failed'], 'Promos apply at checkout if the ride meets the minimum fare and the code hasn''t expired. Please verify the terms on the Offers page.',      0.72, false, 420,  true),
('account_blocked',     ARRAY['account blocked','cant login','my account is suspended'],   'Account suspensions are reviewed by our safety team. You should receive an email with details. For urgent help, escalating to an agent.',   0.90, true,  180,  true),
('lost_item',           ARRAY['i left something','lost item','forgot bag in cab'],         'Sorry to hear that! You can contact your driver via the trip history. If no response in 2 hours, we''ll connect you to our lost & found team.',0.82, false, 310, true);

-- Seeds: chatbot sessions (historical)
INSERT INTO chatbot_sessions (user_type, user_id, channel, status, message_count, deflected, escalated_at, resolved_at) VALUES
('RIDER',  'usr-001', 'APP',      'RESOLVED',  5,  true,  NULL,             NOW() - INTERVAL '1 hour'),
('RIDER',  'usr-002', 'WEB',      'ESCALATED', 8,  false, NOW() - INTERVAL '30 min', NULL),
('DRIVER', 'drv-003', 'APP',      'RESOLVED',  3,  true,  NULL,             NOW() - INTERVAL '2 hours'),
('RIDER',  'usr-004', 'WHATSAPP', 'ACTIVE',    2,  true,  NULL,             NULL),
('RIDER',  'usr-005', 'APP',      'RESOLVED',  12, false, NOW() - INTERVAL '45 min', NOW() - INTERVAL '20 min');
