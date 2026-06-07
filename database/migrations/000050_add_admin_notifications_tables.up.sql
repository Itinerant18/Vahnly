CREATE TABLE IF NOT EXISTS admin_alert_rules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type       VARCHAR(50) NOT NULL UNIQUE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT        NOT NULL DEFAULT '',
  severity         VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  is_enabled       BOOLEAN     NOT NULL DEFAULT true,
  threshold_value  NUMERIC,
  threshold_unit   VARCHAR(50) NOT NULL DEFAULT '',
  window_minutes   INT         NOT NULL DEFAULT 5,
  cooldown_minutes INT         NOT NULL DEFAULT 60,
  channels         TEXT[]      NOT NULL DEFAULT '{}',
  last_fired_at    TIMESTAMPTZ,
  fired_count      INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_alert_recipients (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      UUID        NOT NULL REFERENCES admin_alert_rules(id) ON DELETE CASCADE,
  email        VARCHAR(200) NOT NULL,
  phone        VARCHAR(20)  NOT NULL DEFAULT '',
  slack_user_id VARCHAR(100) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_id, email)
);

CREATE TABLE IF NOT EXISTS admin_notification_channel_configs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel    VARCHAR(20) NOT NULL UNIQUE,
  config     JSONB       NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN     NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type       VARCHAR(50)  NOT NULL,
  severity         VARCHAR(20)  NOT NULL DEFAULT 'HIGH',
  title            VARCHAR(500) NOT NULL,
  body             TEXT         NOT NULL DEFAULT '',
  metadata         JSONB        NOT NULL DEFAULT '{}',
  status           VARCHAR(20)  NOT NULL DEFAULT 'UNREAD',
  acknowledged_by  UUID,
  acknowledged_at  TIMESTAMPTZ,
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  delivery_status  JSONB        NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_notifications_status     ON admin_notifications(status);
CREATE INDEX idx_admin_notifications_alert_type ON admin_notifications(alert_type);
CREATE INDEX idx_admin_notifications_created_at ON admin_notifications(created_at DESC);

-- Seed alert rules (the 6 platform system alerts)
INSERT INTO admin_alert_rules (alert_type, name, description, severity, is_enabled, threshold_value, threshold_unit, window_minutes, cooldown_minutes, channels) VALUES
('SOS',              'SOS Emergency Alert',       'Triggered when a rider or driver activates SOS during a trip.',               'CRITICAL', true, NULL, '',            0,  5,   ARRAY['EMAIL','SLACK','SMS']),
('HIGH_CANCELLATION','High Cancellation Rate',    'Triggered when cancellation rate exceeds threshold in the rolling window.',   'HIGH',     true, 15.0,'PERCENT',     15, 60,  ARRAY['EMAIL','SLACK']),
('SURGE_CAP',        'Surge Cap Hit',             'Triggered when the pricing surge multiplier reaches the configured cap.',    'MEDIUM',   true, 3.0, 'MULTIPLIER',  5,  120, ARRAY['SLACK']),
('PAYMENT_GW_DOWN',  'Payment Gateway Down',      'Triggered when payment gateway health check fails consecutively.',          'CRITICAL', true, 3.0, 'FAILURES',    5,  10,  ARRAY['EMAIL','SLACK','SMS']),
('KYC_BACKLOG_SLA',  'KYC Backlog SLA Breach',    'Triggered when pending KYC documents exceed the SLA threshold.',            'HIGH',     true, 50.0,'COUNT',       60, 240, ARRAY['EMAIL','SLACK']),
('PAYOUT_FAILURE',   'Payout Batch Failure',      'Triggered when payout failures exceed threshold in a processing batch.',    'HIGH',     true, 5.0, 'COUNT',       30, 120, ARRAY['EMAIL','SLACK']);

-- Seed channel configs (disabled by default — admin must configure)
INSERT INTO admin_notification_channel_configs (channel, config, is_enabled) VALUES
('EMAIL', '{"smtp_host":"smtp.gmail.com","smtp_port":587,"from_email":"alerts@drivers-for-u.in","from_name":"Drivers-for-U Alerts"}', false),
('SLACK', '{"webhook_url":"","channel":"#ops-alerts","username":"DFU Bot","icon_emoji":":rotating_light:"}',                         false),
('SMS',   '{"provider":"twilio","from_number":"","account_sid":"","auth_token":""}',                                                 false);

-- Seed sample notifications for the inbox
INSERT INTO admin_notifications (alert_type, severity, title, body, metadata, status, delivery_status) VALUES
('SOS',              'CRITICAL', 'SOS Alert: Trip #ORD-KOL-001 — Near Park Street',             'Driver Aniket K triggered SOS. Last known location: 22.5448°N 88.3426°E. Police notified via auto-dispatch.',      '{"trip_id":"ORD-KOL-001","lat":22.5448,"lng":88.3426,"driver_name":"Aniket K","rider_name":"Sarah Connor"}',       'RESOLVED',      '{"email":"SENT","slack":"SENT","sms":"SENT"}'),
('PAYMENT_GW_DOWN',  'CRITICAL', 'Razorpay Gateway Degraded',                                   'Payment success rate dropped to 67% in last 5 minutes. 3 consecutive health-check failures detected.',             '{"provider":"razorpay","success_rate":67,"failures":3,"last_checked":"2026-06-07T10:14:00Z"}',                     'ACKNOWLEDGED',  '{"email":"SENT","slack":"SENT","sms":"SENT"}'),
('HIGH_CANCELLATION','HIGH',     'Cancellation Rate Spike — Kolkata Central',                   'Cancellation rate hit 23.4% in the last 15 minutes. Threshold is 15%. Possible rain event or supply shortage.',    '{"city":"KOL","rate":23.4,"window_min":15,"trip_count":189}',                                                      'UNREAD',        '{"email":"SENT","slack":"SENT"}'),
('KYC_BACKLOG_SLA',  'HIGH',     'KYC Backlog Exceeds SLA — 67 Pending',                        '67 driver KYC submissions have been pending for more than 24 hours. SLA threshold: 50 documents.',                '{"pending_count":67,"oldest_hours":31,"threshold":50}',                                                            'UNREAD',        '{"email":"SENT","slack":"SENT"}'),
('PAYOUT_FAILURE',   'HIGH',     'Payout Batch Failure — 8 Drivers Affected',                   '8 payout transactions failed in the 10:00 AM batch. Bank: HDFC NEFT. Retry scheduled for 12:00 PM.',              '{"failed_count":8,"batch_id":"BATCH-20260607-001","bank":"HDFC","retry_at":"2026-06-07T12:00:00Z"}',               'READ',          '{"email":"SENT","slack":"SENT"}'),
('SURGE_CAP',        'MEDIUM',   'Surge Cap Hit — Bangalore (3.0×)',                             'Surge multiplier reached the configured cap of 3.0× in Bangalore Central. Demand: 234, Active supply: 67.',       '{"city":"BLR","multiplier":3.0,"demand":234,"supply":67}',                                                         'READ',          '{"email":"FAILED","slack":"SENT"}');
