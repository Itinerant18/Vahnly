-- ── API Keys ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    key_prefix      VARCHAR(20)  NOT NULL,           -- first 8 chars, shown in UI
    key_hash        VARCHAR(128) UNIQUE NOT NULL,     -- SHA-256(key) for lookup
    owner_type      VARCHAR(20)  DEFAULT 'PARTNER' NOT NULL CHECK (owner_type IN ('PARTNER','CORPORATE','INTERNAL')),
    owner_id        VARCHAR(100) DEFAULT '' NOT NULL,
    owner_name      VARCHAR(200) DEFAULT '' NOT NULL,
    scopes          VARCHAR(50)[] DEFAULT '{}'::VARCHAR(50)[] NOT NULL,
    rate_limit_per_min  INT DEFAULT 60     NOT NULL,
    rate_limit_per_day  INT DEFAULT 10000  NOT NULL,
    quota_monthly       INT DEFAULT 100000 NOT NULL,
    is_sandbox      BOOLEAN DEFAULT false NOT NULL,
    is_active       BOOLEAN DEFAULT true  NOT NULL,
    last_used_at    TIMESTAMP WITH TIME ZONE,
    expires_at      TIMESTAMP WITH TIME ZONE,
    created_by      VARCHAR(255) DEFAULT '' NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active, is_sandbox);

-- ── Webhooks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(200) NOT NULL,
    endpoint_url        TEXT         NOT NULL,
    owner_type          VARCHAR(20)  DEFAULT 'PARTNER' NOT NULL,
    owner_id            VARCHAR(100) DEFAULT '' NOT NULL,
    subscribed_events   VARCHAR(100)[] DEFAULT '{}'::VARCHAR(100)[] NOT NULL,
    signing_secret      VARCHAR(100) DEFAULT '' NOT NULL,
    is_active           BOOLEAN DEFAULT true NOT NULL,
    retry_count         INT DEFAULT 3 NOT NULL,
    timeout_ms          INT DEFAULT 5000 NOT NULL,
    last_triggered_at   TIMESTAMP WITH TIME ZONE,
    last_status_code    INT,
    failure_count       INT DEFAULT 0 NOT NULL,
    created_by          VARCHAR(255) DEFAULT '' NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ── API Request Logs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_request_logs (
    id                    BIGSERIAL PRIMARY KEY,
    api_key_id            UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    key_prefix            VARCHAR(20) DEFAULT '' NOT NULL,
    method                VARCHAR(10) NOT NULL,
    path                  VARCHAR(500) NOT NULL,
    status_code           INT NOT NULL,
    response_time_ms      INT DEFAULT 0 NOT NULL,
    request_size_bytes    INT DEFAULT 0 NOT NULL,
    response_size_bytes   INT DEFAULT 0 NOT NULL,
    ip_address            VARCHAR(45) DEFAULT '' NOT NULL,
    is_sandbox            BOOLEAN DEFAULT false NOT NULL,
    error_message         TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_logs_key     ON api_request_logs(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_request_logs(created_at);

-- ── Status Page Incidents ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS status_incidents (
    id                  SERIAL PRIMARY KEY,
    title               VARCHAR(255) NOT NULL,
    description         TEXT DEFAULT '' NOT NULL,
    severity            VARCHAR(20) DEFAULT 'MINOR' NOT NULL CHECK (severity IN ('MINOR','MAJOR','CRITICAL')),
    status              VARCHAR(20) DEFAULT 'INVESTIGATING' NOT NULL
                         CHECK (status IN ('INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED')),
    affected_components VARCHAR(100)[] DEFAULT '{}'::VARCHAR(100)[] NOT NULL,
    started_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at         TIMESTAMP WITH TIME ZONE,
    created_by          VARCHAR(255) DEFAULT '' NOT NULL,
    updated_by          VARCHAR(255) DEFAULT '' NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ── Seed: demo API keys (plaintext keys never stored — prefix + hash only) ───
INSERT INTO api_keys (name, key_prefix, key_hash, owner_type, owner_name, scopes, rate_limit_per_min, is_active, created_by)
VALUES
    ('TechCorp Platform Key', 'dfukey_tc',  encode(sha256('dfukey_tc_demo_key_techcorp_2026'),  'hex'), 'CORPORATE', 'TechCorp India Pvt. Ltd.',   ARRAY['trips:read','trips:write','payments:read'], 120, true, 'system'),
    ('Accenture Test Key',    'dfukey_ac',  encode(sha256('dfukey_ac_demo_key_accenture_2026'), 'hex'), 'CORPORATE', 'Accenture India',             ARRAY['trips:read'], 60, true, 'system'),
    ('Internal Analytics',   'dfukey_int', encode(sha256('dfukey_int_analytics_internal_key'), 'hex'), 'INTERNAL',  'Internal BI team',            ARRAY['trips:read','analytics:read','drivers:read'], 300, true, 'system'),
    ('Sandbox Test Key',     'dfukey_sb',  encode(sha256('dfukey_sb_sandbox_test_key_2026'),   'hex'), 'PARTNER',   'Dev Environment',             ARRAY['trips:read','trips:write','payments:read','payments:write'], 1000, true, 'system')
ON CONFLICT DO NOTHING;

UPDATE api_keys SET is_sandbox = true WHERE key_prefix = 'dfukey_sb';

-- Seed API logs for demo
INSERT INTO api_request_logs (key_prefix, method, path, status_code, response_time_ms, ip_address, is_sandbox, created_at) VALUES
    ('dfukey_tc', 'GET',  '/api/v1/trips',              200, 45,  '103.21.244.10', false, NOW() - INTERVAL '10 minutes'),
    ('dfukey_tc', 'POST', '/api/v1/orders',             201, 123, '103.21.244.10', false, NOW() - INTERVAL '8 minutes'),
    ('dfukey_tc', 'GET',  '/api/v1/trips',              200, 38,  '103.21.244.10', false, NOW() - INTERVAL '5 minutes'),
    ('dfukey_ac', 'GET',  '/api/v1/trips?status=COMPLETED', 200, 56, '34.87.11.22', false, NOW() - INTERVAL '3 minutes'),
    ('dfukey_sb', 'POST', '/api/v1/orders',             201, 89,  '127.0.0.1',     true,  NOW() - INTERVAL '2 minutes'),
    ('dfukey_sb', 'GET',  '/api/v1/drivers/me',         200, 22,  '127.0.0.1',     true,  NOW() - INTERVAL '1 minute'),
    ('dfukey_ac', 'GET',  '/api/v1/trips/invalid-uuid', 404, 12,  '34.87.11.22',   false, NOW() - INTERVAL '30 seconds'),
    ('dfukey_tc', 'POST', '/api/v1/orders',             429, 3,   '103.21.244.10', false, NOW() - INTERVAL '10 seconds')
ON CONFLICT DO NOTHING;

-- Seed webhook
INSERT INTO webhooks (name, endpoint_url, owner_type, owner_name, subscribed_events, signing_secret, is_active, created_by)
VALUES
    ('TechCorp Trip Events',    'https://api.techcorp.in/webhooks/driversfor-u', 'CORPORATE', 'TechCorp India', ARRAY['trip.completed','trip.cancelled'], 'whs_tc_signing_secret_2026', true, 'system'),
    ('Accenture Payment Events','https://hooks.accenture.in/payments',           'CORPORATE', 'Accenture India', ARRAY['payment.refunded','payout.processed'], 'whs_ac_signing_secret_2026', true, 'system')
ON CONFLICT DO NOTHING;

-- Seed status incident
INSERT INTO status_incidents (title, description, severity, status, affected_components, started_at, created_by)
VALUES ('Elevated API Latency', 'We are investigating elevated response times on the matching API endpoint. Trip creation may be slower than usual.', 'MINOR', 'MONITORING', ARRAY['matching-api','dispatch-service'], NOW() - INTERVAL '2 hours', 'system')
ON CONFLICT DO NOTHING;
