DROP INDEX IF EXISTS idx_car_issue_reports_reviewed;
ALTER TABLE car_issue_reports
    DROP COLUMN IF EXISTS reviewed,
    DROP COLUMN IF EXISTS admin_notes,
    DROP COLUMN IF EXISTS reviewed_by,
    DROP COLUMN IF EXISTS reviewed_at;
