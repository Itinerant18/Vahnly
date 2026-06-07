-- ── Audit-mode Impersonation ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID         NOT NULL,
  admin_email     VARCHAR(200)  NOT NULL,
  target_type     VARCHAR(20)   NOT NULL,
  target_id       VARCHAR(100)  NOT NULL,
  reason          TEXT          NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  actions_taken   INT           NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ
);

CREATE INDEX idx_impersonation_admin ON impersonation_sessions(admin_email, started_at DESC);

-- ── Bulk Operations Center ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_operations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type   VARCHAR(50)   NOT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  total_count      INT           NOT NULL DEFAULT 0,
  processed_count  INT           NOT NULL DEFAULT 0,
  failed_count     INT           NOT NULL DEFAULT 0,
  created_by       VARCHAR(200)  NOT NULL,
  approved_by      VARCHAR(200),
  approved_at      TIMESTAMPTZ,
  note             TEXT          NOT NULL DEFAULT '',
  payload          JSONB         NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

-- ── Cron / Job Monitor ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_jobs (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name              VARCHAR(100)  NOT NULL UNIQUE,
  description           VARCHAR(500)  NOT NULL DEFAULT '',
  cron_expr             VARCHAR(50)   NOT NULL,
  last_run_at           TIMESTAMPTZ,
  next_run_at           TIMESTAMPTZ,
  last_status           VARCHAR(20)   NOT NULL DEFAULT 'NEVER_RUN',
  last_duration_ms      INT           NOT NULL DEFAULT 0,
  last_rows_processed   INT           NOT NULL DEFAULT 0,
  consecutive_failures  INT           NOT NULL DEFAULT 0,
  is_enabled            BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        VARCHAR(100) NOT NULL,
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          VARCHAR(20)  NOT NULL DEFAULT 'RUNNING',
  rows_processed  INT          NOT NULL DEFAULT 0,
  error           TEXT         NOT NULL DEFAULT ''
);

CREATE INDEX idx_cron_runs_job ON cron_job_runs(job_name, started_at DESC);

-- ── Data Export Marketplace ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_queries (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200)  NOT NULL,
  description    TEXT          NOT NULL DEFAULT '',
  category       VARCHAR(50)   NOT NULL,
  query_template TEXT          NOT NULL,
  params_schema  JSONB         NOT NULL DEFAULT '{}',
  is_public      BOOLEAN       NOT NULL DEFAULT true,
  download_count INT           NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id         UUID         REFERENCES export_queries(id),
  query_name       VARCHAR(200)  NOT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'QUEUED',
  params           JSONB         NOT NULL DEFAULT '{}',
  row_count        INT           NOT NULL DEFAULT 0,
  file_size_bytes  INT           NOT NULL DEFAULT 0,
  file_url         VARCHAR(500)  NOT NULL DEFAULT '',
  created_by       VARCHAR(200)  NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

-- Seeds: impersonation sessions
INSERT INTO impersonation_sessions (admin_id, admin_email, target_type, target_id, reason, status, actions_taken, started_at, ended_at) VALUES
(gen_random_uuid(), 'admin@drivers-for-u.in', 'RIDER',  'usr-0042', 'User reported unexpected charges; debugging wallet deduction logic',        'ENDED',  4, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '18 minutes'),
(gen_random_uuid(), 'admin@drivers-for-u.in', 'DRIVER', 'drv-0019', 'Driver claims payout not received; replicating payout flow as driver',      'ENDED',  7, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '32 minutes');

-- Seeds: bulk operations
INSERT INTO bulk_operations (operation_type, status, total_count, processed_count, failed_count, created_by, approved_by, note) VALUES
('CREDIT',     'COMPLETED', 1240, 1238, 2, 'ops@drivers-for-u.in', 'superadmin@drivers-for-u.in', 'Wallet credit ₹50 for Diwali goodwill gesture — active riders in KOL'),
('SUSPEND',    'PENDING',   87,   0,    0, 'safety@drivers-for-u.in', NULL,                       'Suspend driver accounts flagged by fraud model (score > 80, GPS spoofing)'),
('MESSAGE',    'COMPLETED', 5420, 5420, 0, 'marketing@drivers-for-u.in','superadmin@drivers-for-u.in','Push notification: Monsoon safety tips for all drivers');

-- Seeds: cron jobs
INSERT INTO cron_jobs (job_name, description, cron_expr, last_run_at, next_run_at, last_status, last_duration_ms, last_rows_processed, consecutive_failures, is_enabled) VALUES
('daily_settlement',        'Settle driver payouts for previous day',                      '0 2 * * *',   NOW() - INTERVAL '22 hours', NOW() + INTERVAL '2 hours',  'SUCCESS', 4820,  8432,  0, true),
('kyc_expiry_alerts',       'Send renewal reminders for expiring KYC documents',           '0 9 * * *',   NOW() - INTERVAL '15 hours', NOW() + INTERVAL '9 hours',  'SUCCESS', 1240,  127,   0, true),
('fraud_score_recalc',      'Recalculate anomaly scores for all drivers using rule engine', '0 * * * *',   NOW() - INTERVAL '45 min',   NOW() + INTERVAL '15 min',   'SUCCESS', 8100,  24710, 0, true),
('demand_forecast_gen',     'Generate 6-hour demand forecasts for all active zones',       '30 * * * *',  NOW() - INTERVAL '25 min',   NOW() + INTERVAL '5 min',    'SUCCESS', 3200,  1440,  0, true),
('carbon_records_agg',      'Aggregate trip emissions into carbon_records table',          '0 3 * * *',   NOW() - INTERVAL '21 hours', NOW() + INTERVAL '3 hours',  'SUCCESS', 9400,  91230, 0, true),
('document_expiry_check',   'Flag documents expiring in next 30 days in documents_vault',  '0 8 * * *',   NOW() - INTERVAL '16 hours', NOW() + INTERVAL '8 hours',  'SUCCESS', 2100,  340,   0, true),
('export_job_cleanup',      'Delete export files older than 7 days from storage',          '0 4 * * 0',   NOW() - INTERVAL '3 days',   NOW() + INTERVAL '4 days',   'SUCCESS', 890,   23,    0, true),
('telematics_summary_build','Build daily telematics summary per driver from raw events',   '0 1 * * *',   NOW() - INTERVAL '23 hours', NOW() + INTERVAL '1 hour',   'FAILED',  0,     0,     2, true);

INSERT INTO cron_job_runs (job_name, started_at, finished_at, status, rows_processed, error) VALUES
('daily_settlement', NOW() - INTERVAL '22 hours', NOW() - INTERVAL '22 hours' + INTERVAL '4.82 seconds', 'SUCCESS', 8432, ''),
('telematics_summary_build', NOW() - INTERVAL '23 hours', NOW() - INTERVAL '23 hours' + INTERVAL '0.4 seconds', 'FAILED',  0, 'relation "telematics_events" does not exist — migration pending'),
('telematics_summary_build', NOW() - INTERVAL '47 hours', NOW() - INTERVAL '47 hours' + INTERVAL '0.4 seconds', 'FAILED',  0, 'relation "telematics_events" does not exist — migration pending');

-- Seeds: export queries
INSERT INTO export_queries (name, description, category, query_template, params_schema, is_public, download_count) VALUES
('Completed Trips Report',    'All completed trips within a date range with fare breakdown',
 'TRIPS',    'SELECT id, created_at, pickup_address, dropoff_address, fare_paise, driver_id, rider_id FROM orders WHERE status=''COMPLETED'' AND created_at BETWEEN :from AND :to',
 '{"from":{"type":"date","required":true},"to":{"type":"date","required":true}}', true, 142),
('Driver Earnings Summary',   'Total earnings per driver for a given period',
 'FINANCE',  'SELECT driver_id, SUM(driver_earning_paise) total_earning_paise, COUNT(*) trip_count FROM orders WHERE status=''COMPLETED'' AND created_at BETWEEN :from AND :to GROUP BY driver_id',
 '{"from":{"type":"date","required":true},"to":{"type":"date","required":true}}', true, 87),
('KYC Pending Drivers',       'All drivers with pending KYC documents',
 'DRIVERS',  'SELECT d.id, d.full_name, d.phone, d.created_at, d.kyc_status FROM drivers d WHERE d.kyc_status IN (''PENDING'',''UNDER_REVIEW'')',
 '{}', true, 34),
('Rider Wallet Balances',     'All rider wallets with current balance',
 'RIDERS',   'SELECT r.id, r.full_name, r.phone, w.balance_paise FROM riders r JOIN wallets w ON w.user_id=r.id WHERE w.user_type=''RIDER''',
 '{}', false, 12),
('Fraud Events Export',       'Fraud events filtered by type and status',
 'COMPLIANCE','SELECT id, entity_type, entity_id, fraud_type, score, status, created_at FROM fraud_events WHERE fraud_type = :fraud_type AND status = :status',
 '{"fraud_type":{"type":"string","required":false},"status":{"type":"string","required":false}}', false, 6),
('Carbon Records Monthly',    'Monthly carbon emission records per vehicle type',
 'COMPLIANCE','SELECT vehicle_type, COUNT(*) trips, SUM(distance_km) total_km, SUM(emission_kg) total_emission_kg FROM carbon_records WHERE recorded_date BETWEEN :from AND :to GROUP BY vehicle_type',
 '{"from":{"type":"date","required":true},"to":{"type":"date","required":true}}', true, 18);

INSERT INTO export_jobs (query_name, status, params, row_count, file_size_bytes, file_url, created_by, created_at, completed_at) VALUES
('Completed Trips Report', 'COMPLETED', '{"from":"2026-06-01","to":"2026-06-07"}', 91230, 8421034, '/exports/trips-2026-06-01-2026-06-07.csv', 'finance@drivers-for-u.in', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '3 hours 58 min'),
('Driver Earnings Summary', 'FAILED',   '{"from":"2026-05-01","to":"2026-05-31"}', 0,     0,        '', 'ops@drivers-for-u.in', NOW() - INTERVAL '1 day', NULL);
