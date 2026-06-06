-- ── 20.1 Global platform settings (key-value) ──────────────────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
    key           VARCHAR(100) PRIMARY KEY,
    value         TEXT NOT NULL DEFAULT '',
    data_type     VARCHAR(20)  DEFAULT 'string'  NOT NULL, -- string | number | boolean | json
    category      VARCHAR(50)  DEFAULT 'general' NOT NULL, -- brand | locale | support | legal
    description   TEXT         DEFAULT ''        NOT NULL,
    updated_by    VARCHAR(255) DEFAULT ''        NOT NULL,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO platform_settings (key, value, data_type, category, description) VALUES
    ('brand.app_name',            'Drivers-for-U',            'string',  'brand',   'App display name'),
    ('brand.logo_url',            'https://cdn.driversfor-u.in/logo.svg', 'string', 'brand', 'Primary logo URL'),
    ('brand.primary_color',       '#6366F1',                  'string',  'brand',   'Primary brand color (hex)'),
    ('brand.secondary_color',     '#10B981',                  'string',  'brand',   'Secondary brand color (hex)'),
    ('locale.default_language',   'en',                       'string',  'locale',  'Default app language code'),
    ('locale.currency',           'INR',                      'string',  'locale',  'Platform currency'),
    ('locale.currency_symbol',    '₹',                        'string',  'locale',  'Currency symbol'),
    ('locale.timezone',           'Asia/Kolkata',             'string',  'locale',  'Default timezone'),
    ('support.email',             'support@driversfor-u.in',  'string',  'support', 'Public support email'),
    ('support.phone',             '+91 1800-XXX-XXXX',        'string',  'support', 'Support helpline number'),
    ('support.chat_enabled',      'true',                     'boolean', 'support', 'In-app chat enabled'),
    ('legal.terms_url',           '/content/terms-and-conditions', 'string', 'legal', 'Terms & Conditions URL'),
    ('legal.privacy_url',         '/content/privacy-policy',  'string',  'legal',   'Privacy Policy URL'),
    ('legal.cancellation_url',    '/content/cancellation-policy', 'string', 'legal', 'Cancellation Policy URL'),
    ('legal.refund_url',          '/content/refund-policy',   'string',  'legal',   'Refund Policy URL'),
    ('legal.gstin',               '19AABCD1234F1Z9',          'string',  'legal',   'Platform GST number')
ON CONFLICT (key) DO NOTHING;

-- ── 20.2 Feature flags ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
    id                  SERIAL PRIMARY KEY,
    flag_key            VARCHAR(100) UNIQUE NOT NULL,
    name                VARCHAR(200)  NOT NULL,
    description         TEXT DEFAULT '' NOT NULL,
    is_enabled          BOOLEAN DEFAULT false NOT NULL,
    rollout_percentage  INT DEFAULT 0 NOT NULL CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    target_cities       VARCHAR(20)[] DEFAULT '{}'::VARCHAR(20)[] NOT NULL,
    target_roles        VARCHAR(50)[] DEFAULT '{}'::VARCHAR(50)[] NOT NULL,
    is_kill_switch      BOOLEAN DEFAULT false NOT NULL,
    created_by          VARCHAR(255) DEFAULT '' NOT NULL,
    updated_by          VARCHAR(255) DEFAULT '' NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO feature_flags (flag_key, name, description, is_enabled, rollout_percentage, is_kill_switch) VALUES
    ('batch_matching',         'Hungarian Batch Matching',         'Enable Kuhn-Munkres batch assignment algorithm',                      true,  100, false),
    ('google_maps_eta',        'Google Maps ETA',                  'Use Google Maps Distance Matrix API for ETA calculation',             false, 0,   false),
    ('surge_pricing',          'Surge Pricing',                    'Enable dynamic surge multiplier based on supply/demand ratio',        true,  100, false),
    ('d4m_care_insurance',     'D4M Care Insurance',               'Enable optional rider insurance product on booking',                  true,  100, false),
    ('multi_stop_trips',       'Multi-Stop Trips',                 'Allow riders to add intermediate stops during booking',               false, 20,  false),
    ('live_tracking_rider',    'Live Driver Tracking (Rider App)', 'Show real-time driver location on rider home screen',                 true,  100, false),
    ('chat_support',           'In-App Chat Support',              'Enable live chat with support agents inside the app',                 true,  100, false),
    ('whatsapp_notifications', 'WhatsApp Notifications',           'Send trip updates and OTP via WhatsApp Business API',                 false, 0,   false),
    ('maintenance_mode',       'Maintenance Mode Kill Switch',     'Disables all new bookings and shows maintenance banner to users',     false, 0,   true)
ON CONFLICT (flag_key) DO NOTHING;

-- ── 20.3 App version management ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_versions (
    id                    SERIAL PRIMARY KEY,
    platform              VARCHAR(10) NOT NULL CHECK (platform IN ('iOS', 'ANDROID')),
    version_string        VARCHAR(20) NOT NULL,
    build_number          INT DEFAULT 0 NOT NULL,
    release_type          VARCHAR(20) DEFAULT 'OPTIONAL' NOT NULL CHECK (release_type IN ('FORCE', 'OPTIONAL', 'SILENT')),
    min_supported_version VARCHAR(20) DEFAULT '' NOT NULL,
    release_notes         TEXT DEFAULT '' NOT NULL,
    store_url             TEXT DEFAULT '' NOT NULL,
    is_latest             BOOLEAN DEFAULT false NOT NULL,
    created_by            VARCHAR(255) DEFAULT '' NOT NULL,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_versions_platform ON app_versions(platform, is_latest);

INSERT INTO app_versions (platform, version_string, build_number, release_type, min_supported_version, release_notes, store_url, is_latest, created_by) VALUES
    ('iOS',     '3.4.1', 340100, 'OPTIONAL', '3.0.0', 'Bug fixes and performance improvements. Improved ETA accuracy.', 'https://apps.apple.com/in/app/driversfor-u/id123456789',    true,  'system'),
    ('ANDROID', '3.4.1', 340100, 'OPTIONAL', '3.0.0', 'Bug fixes and performance improvements. Improved ETA accuracy.', 'https://play.google.com/store/apps/details?id=in.driversfor_u', true, 'system'),
    ('iOS',     '3.3.0', 330000, 'FORCE',    '2.9.0', 'Critical security patch + new surge pricing UI.',              'https://apps.apple.com/in/app/driversfor-u/id123456789',    false, 'system'),
    ('ANDROID', '3.3.0', 330000, 'FORCE',    '2.9.0', 'Critical security patch + new surge pricing UI.',              'https://play.google.com/store/apps/details?id=in.driversfor_u', false, 'system')
ON CONFLICT DO NOTHING;

-- ── 20.4 Integration configurations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_configs (
    id               SERIAL PRIMARY KEY,
    integration_key  VARCHAR(100) UNIQUE NOT NULL,
    display_name     VARCHAR(200) NOT NULL,
    category         VARCHAR(50)  NOT NULL, -- payment | messaging | maps | kyc | analytics | crm
    logo_emoji       VARCHAR(10)  DEFAULT '🔌' NOT NULL,
    is_enabled       BOOLEAN      DEFAULT false NOT NULL,
    config_json      JSONB        DEFAULT '{}'::JSONB NOT NULL,
    api_key_masked   VARCHAR(100) DEFAULT '' NOT NULL,
    webhook_url      TEXT         DEFAULT '' NOT NULL,
    health_status    VARCHAR(20)  DEFAULT 'UNKNOWN' NOT NULL CHECK (health_status IN ('HEALTHY','DEGRADED','DOWN','UNKNOWN')),
    last_health_check TIMESTAMP WITH TIME ZONE,
    updated_by       VARCHAR(255) DEFAULT '' NOT NULL,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO integration_configs (integration_key, display_name, category, logo_emoji, is_enabled, config_json) VALUES
    ('razorpay',      'Razorpay',            'payment',    '💳', false, '{"capture_auto":true,"payment_capture_timeout":300}'),
    ('stripe',        'Stripe',              'payment',    '💳', false, '{}'),
    ('fcm',           'Firebase (FCM)',       'messaging',  '🔔', false, '{"project_id":"driversfor-u-prod"}'),
    ('apns',          'Apple Push (APNs)',    'messaging',  '🍎', false, '{"bundle_id":"in.driversfor-u.rider"}'),
    ('twilio_sms',    'Twilio SMS',          'messaging',  '📱', false, '{"from_number":"+14155238886"}'),
    ('whatsapp_biz',  'WhatsApp Business',   'messaging',  '💬', false, '{"phone_number_id":""}'),
    ('google_maps',   'Google Maps Platform','maps',       '🗺', true,  '{"distance_matrix":true,"geocoding":true}'),
    ('mapbox',        'Mapbox',              'maps',       '🗺', false, '{}'),
    ('digilocker',    'DigiLocker KYC',      'kyc',        '🪪', false, '{"client_id":""}'),
    ('authbridge',    'Authbridge BGV',      'kyc',        '🔍', false, '{"base_url":"https://api.authbridge.com"}'),
    ('exotel',        'Exotel Call Masking', 'crm',        '📞', false, '{"sid":""}'),
    ('knowlarity',    'Knowlarity',          'crm',        '📞', false, '{}'),
    ('mixpanel',      'Mixpanel Analytics',  'analytics',  '📊', false, '{"project_token":""}'),
    ('segment',       'Segment CDP',         'analytics',  '📊', false, '{"write_key":""}'),
    ('zoho_books',    'Zoho Books',          'accounting', '📒', false, '{"organization_id":""}'),
    ('tally',         'Tally ERP',           'accounting', '📒', false, '{}')
ON CONFLICT (integration_key) DO NOTHING;

-- ── 20.5 Notification templates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_templates (
    id               SERIAL PRIMARY KEY,
    template_key     VARCHAR(100) UNIQUE NOT NULL,
    name             VARCHAR(200) NOT NULL,
    channel          VARCHAR(20)  NOT NULL CHECK (channel IN ('PUSH','SMS','EMAIL','WHATSAPP')),
    event_trigger    VARCHAR(100) DEFAULT '' NOT NULL,
    title_template   TEXT         DEFAULT '' NOT NULL,
    body_template    TEXT         NOT NULL,
    variables        VARCHAR(50)[] DEFAULT '{}'::VARCHAR(50)[] NOT NULL,
    language_code    VARCHAR(10)  DEFAULT 'en' NOT NULL,
    is_active        BOOLEAN      DEFAULT true NOT NULL,
    created_by       VARCHAR(255) DEFAULT '' NOT NULL,
    updated_by       VARCHAR(255) DEFAULT '' NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO notification_templates (template_key, name, channel, event_trigger, title_template, body_template, variables) VALUES
    ('push_driver_assigned',  'Driver Assigned (Push)',    'PUSH',  'DRIVER_ASSIGNED',  'Your driver is on the way!',    'Hi {{rider_name}}, {{driver_name}} ({{plate}}) is heading to you. ETA: {{eta_min}} mins.',    ARRAY['rider_name','driver_name','plate','eta_min']),
    ('push_trip_started',     'Trip Started (Push)',       'PUSH',  'TRIP_STARTED',     'Your trip has started',         'You are now on your way to {{destination}}. Estimated arrival: {{eta_min}} mins.',             ARRAY['destination','eta_min']),
    ('push_trip_completed',   'Trip Completed (Push)',     'PUSH',  'TRIP_COMPLETED',   'Trip completed! Rate your ride','Hope you enjoyed your ride. Fare: ₹{{fare}}. Tap to rate {{driver_name}}.',                   ARRAY['fare','driver_name']),
    ('sms_otp',               'OTP (SMS)',                 'SMS',   'OTP_REQUESTED',    '',                              'Your Drivers-for-U OTP is {{otp}}. Valid for 10 minutes. Do not share. - DRVRSU',              ARRAY['otp']),
    ('sms_driver_assigned',   'Driver Assigned (SMS)',     'SMS',   'DRIVER_ASSIGNED',  '',                              'Driver {{driver_name}} ({{plate}}) assigned. OTP: {{otp}}. Track: driversfor-u.in/track',      ARRAY['driver_name','plate','otp']),
    ('email_trip_receipt',    'Trip Receipt (Email)',      'EMAIL', 'TRIP_COMPLETED',   'Your trip receipt – ₹{{fare}}', 'Dear {{rider_name}},\n\nTrip from {{pickup}} to {{dropoff}}.\nFare: ₹{{fare}}\nDate: {{date}}', ARRAY['rider_name','pickup','dropoff','fare','date']),
    ('wa_driver_assigned',    'Driver Assigned (WhatsApp)','WHATSAPP','DRIVER_ASSIGNED','',                              '🚗 Your Drivers-for-U driver is on the way!\n\nDriver: {{driver_name}}\nVehicle: {{plate}}\nETA: {{eta_min}} mins\nOTP: {{otp}}', ARRAY['driver_name','plate','eta_min','otp']),
    ('push_sos_ack',          'SOS Acknowledged (Push)',   'PUSH',  'SOS_ACKNOWLEDGED', 'SOS received — help is coming', 'Our safety team has been alerted. Emergency services notified. Stay calm.',                     ARRAY[])
ON CONFLICT (template_key) DO NOTHING;

-- ── 20.6 Cancellation & refund policy rules ───────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_policy_rules (
    id                          SERIAL PRIMARY KEY,
    rule_name                   VARCHAR(200) NOT NULL,
    applies_to                  VARCHAR(20) NOT NULL CHECK (applies_to IN ('RIDER','DRIVER','BOTH')),
    trip_status_at_cancel       VARCHAR(30) NOT NULL,
    minutes_elapsed_min         INT DEFAULT 0 NOT NULL,
    minutes_elapsed_max         INT DEFAULT 999999 NOT NULL,
    cancellation_fee_pct        NUMERIC(5,2) DEFAULT 0 NOT NULL,
    cancellation_fee_fixed_paise INT DEFAULT 0 NOT NULL,
    refund_pct                  NUMERIC(5,2) DEFAULT 100 NOT NULL,
    party_at_fault              VARCHAR(20) DEFAULT 'NONE' NOT NULL CHECK (party_at_fault IN ('RIDER','DRIVER','PLATFORM','NONE')),
    is_active                   BOOLEAN DEFAULT true NOT NULL,
    priority                    INT DEFAULT 0 NOT NULL,
    created_by                  VARCHAR(255) DEFAULT '' NOT NULL,
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO cancellation_policy_rules (rule_name, applies_to, trip_status_at_cancel, minutes_elapsed_min, minutes_elapsed_max, cancellation_fee_pct, cancellation_fee_fixed_paise, refund_pct, party_at_fault, priority) VALUES
    ('Free Cancel (0-3 min, pre-assign)',    'RIDER',  'CREATED',              0,  3,  0,   0,     100,  'NONE',   100),
    ('Light Fee (3-7 min, pre-assign)',      'RIDER',  'CREATED',              3,  7,  10,  0,     90,   'RIDER',  90),
    ('Standard Fee (>7 min, pre-assign)',    'RIDER',  'CREATED',              7,  999999, 15, 0,  85,   'RIDER',  80),
    ('Free Cancel (0-5 min, driver en-route)','RIDER', 'ASSIGNED',             0,  5,  0,   0,     100,  'NONE',   70),
    ('Standard Fee (5+ min, driver en-route)','RIDER', 'ASSIGNED',             5,  999999, 20, 0,  80,   'RIDER',  60),
    ('Driver No-show (>10 min wait)',        'DRIVER', 'EN_ROUTE_TO_PICKUP',   10, 999999, 0, 0,   100,  'DRIVER', 50),
    ('Driver Cancel (post-assign)',          'DRIVER', 'ASSIGNED',             0,  999999, 0, 5000, 100, 'DRIVER', 40)
ON CONFLICT DO NOTHING;

-- ── 20.7 Rating threshold rules ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rating_threshold_rules (
    id                        SERIAL PRIMARY KEY,
    applies_to                VARCHAR(20) NOT NULL CHECK (applies_to IN ('DRIVER','RIDER')),
    threshold_type            VARCHAR(20) NOT NULL CHECK (threshold_type IN ('WARNING','SUSPEND','BAN')),
    min_trips_required        INT DEFAULT 10 NOT NULL,
    rating_below              NUMERIC(3,2) NOT NULL,
    action                    VARCHAR(30) NOT NULL,
    cooldown_days             INT DEFAULT 30 NOT NULL,
    notification_template_key VARCHAR(100) DEFAULT '' NOT NULL,
    is_active                 BOOLEAN DEFAULT true NOT NULL,
    updated_at                TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO rating_threshold_rules (applies_to, threshold_type, min_trips_required, rating_below, action, cooldown_days) VALUES
    ('DRIVER', 'WARNING', 10, 4.00, 'SEND_WARNING',  0),
    ('DRIVER', 'SUSPEND', 20, 3.50, 'AUTO_SUSPEND',  30),
    ('DRIVER', 'BAN',     50, 3.00, 'AUTO_BAN',      90),
    ('RIDER',  'WARNING', 5,  2.50, 'SEND_WARNING',  0),
    ('RIDER',  'SUSPEND', 10, 2.00, 'AUTO_SUSPEND',  14)
ON CONFLICT DO NOTHING;
