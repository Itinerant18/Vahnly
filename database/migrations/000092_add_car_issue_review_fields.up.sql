-- Phase 11: admin review workflow for car issue reports.
ALTER TABLE car_issue_reports
    ADD COLUMN IF NOT EXISTS reviewed     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS admin_notes  TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_car_issue_reports_reviewed ON car_issue_reports(reviewed);
