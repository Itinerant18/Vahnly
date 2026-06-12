-- Driver/rider support tickets created from the app carry image attachments
-- (S3 keys). The existing support_tickets table (admin-side) had no column for them.
ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS attachments TEXT[] NOT NULL DEFAULT '{}';
