-- Decouple the financial review/hold lifecycle from the dispatch order_status_enum.
-- Mutating order_status_enum (ALTER TYPE ... ADD VALUE) is transaction-hostile under
-- golang-migrate and would force ~10 dispatch/admin switch sites to handle a financial
-- state. A dedicated column keeps the financial hold orthogonal and cleanly reversible.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS financial_status VARCHAR(30) NOT NULL DEFAULT 'CLEARED'
        CHECK (financial_status IN ('CLEARED', 'REVIEW_REQUIRED'));

CREATE INDEX IF NOT EXISTS idx_orders_financial_status ON orders(financial_status)
    WHERE financial_status <> 'CLEARED';
