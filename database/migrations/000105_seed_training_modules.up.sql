-- training_modules was created twice with different shapes: 000052 (driver_ops) made
-- it first, so 000072's `CREATE TABLE IF NOT EXISTS` silently no-op'd and the columns
-- the driver-features training handler reads (duration_label / module_type /
-- pass_threshold / display_order) never existed — GET /driver-account/training and the
-- quiz-submit endpoint errored at runtime against the live schema.
--
-- Reconcile additively: add the four columns the handler needs (the 000052 columns —
-- category/content_url/duration_mins/is_mandatory/pass_score — are kept for the
-- driver_ops consumers), then seed the module catalogue. Quiz questions/answers are
-- delivered client-side / via CMS, so there is no question table to seed. Titles,
-- durations and thresholds are go-live defaults — review with training/ops before launch.
ALTER TABLE training_modules
    ADD COLUMN IF NOT EXISTS duration_label VARCHAR(24) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS module_type    VARCHAR(24) NOT NULL DEFAULT 'REQUIRED',
    ADD COLUMN IF NOT EXISTS pass_threshold INT         NOT NULL DEFAULT 80,
    ADD COLUMN IF NOT EXISTS display_order  INT         NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_training_modules_title ON training_modules(title);

-- Backfill the pre-existing (000052-seeded) modules so they render in the driver app
-- too: derive the new columns from the 000052 columns those rows already carry.
UPDATE training_modules
SET duration_label = duration_mins::text || ' min',
    module_type    = CASE WHEN is_mandatory THEN 'REQUIRED' ELSE 'OPTIONAL_BADGE' END,
    pass_threshold = pass_score
WHERE duration_label = '';

-- Both schema generations are populated coherently (pass_score == pass_threshold,
-- is_mandatory == module_type REQUIRED, duration_mins ~ duration_label) so either
-- consumer reads sensible values.
INSERT INTO training_modules
    (title, category, content_url, duration_mins, is_mandatory, pass_score,
     duration_label, module_type, pass_threshold, display_order, is_active)
VALUES
    ('Getting Started: App & Going Online', 'ONBOARDING', '', 6,  true,  80, '6 min',  'REQUIRED',       80, 1, true),
    ('Accepting & Completing Trips',        'OPERATIONS', '', 8,  true,  80, '8 min',  'REQUIRED',       80, 2, true),
    ('Rider Safety & Code of Conduct',      'SAFETY',     '', 10, true,  80, '10 min', 'REQUIRED',       80, 3, true),
    ('Payments, Earnings & Weekly Payouts', 'PAYMENTS',   '', 7,  true,  80, '7 min',  'REQUIRED',       80, 4, true),
    ('Emergency & SOS Procedures',          'SAFETY',     '', 6,  true,  85, '6 min',  'REQUIRED',       85, 5, true),
    ('Kolkata Rules, Permits & Compliance', 'COMPLIANCE', '', 9,  true,  80, '9 min',  'REQUIRED',       80, 6, true),
    ('5-Star Service Excellence',           'QUALITY',    '', 5,  false, 90, '5 min',  'OPTIONAL_BADGE', 90, 7, true)
ON CONFLICT (title) DO NOTHING;
