DROP INDEX IF EXISTS idx_orders_financial_status;
ALTER TABLE orders DROP COLUMN IF EXISTS financial_status;
