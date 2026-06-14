DELETE FROM training_modules WHERE title IN (
    'Getting Started: App & Going Online',
    'Accepting & Completing Trips',
    'Rider Safety & Code of Conduct',
    'Payments, Earnings & Weekly Payouts',
    'Emergency & SOS Procedures',
    'Kolkata Rules, Permits & Compliance',
    '5-Star Service Excellence'
);
DROP INDEX IF EXISTS uq_training_modules_title;
ALTER TABLE training_modules
    DROP COLUMN IF EXISTS duration_label,
    DROP COLUMN IF EXISTS module_type,
    DROP COLUMN IF EXISTS pass_threshold,
    DROP COLUMN IF EXISTS display_order;
