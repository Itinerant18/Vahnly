-- Rider order/trip history: ListOrders filters rider_id and sorts created_at DESC.
-- The existing idx_orders_rider covers only rider_id, forcing a sort over matched rows;
-- this composite lets Postgres satisfy the ORDER BY straight from the index.
--
-- Built CONCURRENTLY so it does not take a write lock on a large production orders table.
-- This file intentionally contains a SINGLE statement: golang-migrate's postgres driver
-- execs the whole file in one simple query, and a multi-statement query runs inside an
-- implicit transaction block — which CREATE INDEX CONCURRENTLY forbids. One statement per
-- migration keeps it out of any transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_rider_created ON orders (rider_id, created_at DESC);
