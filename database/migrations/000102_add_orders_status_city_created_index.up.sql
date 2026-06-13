-- Admin trips list: trip_handler filters status + city_prefix and sorts created_at DESC.
-- The only prior support, idx_orders_matching_fence, is partial (status='CREATED' only),
-- so general admin filtering fell back to a seq scan + sort.
--
-- Built CONCURRENTLY (no write lock). Single statement per file — see the note in
-- 000101_add_orders_rider_created_index.up.sql for why CONCURRENTLY requires this.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_city_created ON orders (status, city_prefix, created_at DESC);
