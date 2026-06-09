DROP INDEX IF EXISTS idx_driver_notifications_lookup;
DROP TABLE IF EXISTS driver_notifications;
DROP INDEX IF EXISTS idx_ledger_entries_driver_date;
DROP TABLE IF EXISTS driver_wallets;
ALTER TABLE financial_ledger_entries DROP COLUMN IF EXISTS driver_id;
