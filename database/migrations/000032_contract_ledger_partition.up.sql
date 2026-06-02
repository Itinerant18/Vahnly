-- Safe throttled asynchronous historical data consolidation block
UPDATE financial_ledger_entries 
SET regional_settlement_zone = city_prefix 
WHERE regional_settlement_zone IS NULL;

ALTER TABLE financial_ledger_entries ALTER COLUMN regional_settlement_zone SET NOT NULL;
