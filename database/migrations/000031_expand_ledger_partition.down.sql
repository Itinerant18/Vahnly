DROP INDEX IF EXISTS idx_ledger_regional_zone;
ALTER TABLE financial_ledger_entries DROP COLUMN IF EXISTS regional_settlement_zone;
ALTER TABLE financial_ledger_entries DROP COLUMN IF EXISTS reference_currency;
