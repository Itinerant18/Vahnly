-- Drop indices
DROP INDEX IF EXISTS idx_payout_requests_batch;
DROP INDEX IF EXISTS idx_payout_requests_status;
DROP INDEX IF EXISTS idx_payout_requests_driver;

-- Drop table
DROP TABLE IF EXISTS payout_requests;

-- Remove columns from drivers table
ALTER TABLE drivers DROP COLUMN IF EXISTS payout_hold_reason;
ALTER TABLE drivers DROP COLUMN IF EXISTS payout_hold;
ALTER TABLE drivers DROP COLUMN IF EXISTS bank_verified;
ALTER TABLE drivers DROP COLUMN IF EXISTS bank_ifsc;
ALTER TABLE drivers DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE drivers DROP COLUMN IF EXISTS bank_name;
