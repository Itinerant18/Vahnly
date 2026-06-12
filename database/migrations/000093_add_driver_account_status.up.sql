-- Driver account moderation status, set by admin actions (suspend/block/unblock).
-- Previously this state lived only in a Redis override key and was lost on cache
-- flush; Postgres is now the system of record.
ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

COMMENT ON COLUMN drivers.account_status IS 'ACTIVE | SUSPENDED | BLOCKED — admin moderation state';
