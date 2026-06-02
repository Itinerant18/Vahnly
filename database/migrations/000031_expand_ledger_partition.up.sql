ALTER TABLE financial_ledger_entries ADD COLUMN reference_currency VARCHAR(10) DEFAULT 'INR';
ALTER TABLE financial_ledger_entries ADD COLUMN regional_settlement_zone VARCHAR(16);
CREATE INDEX idx_ledger_regional_zone ON financial_ledger_entries(regional_settlement_zone) WHERE regional_settlement_zone IS NOT NULL;
