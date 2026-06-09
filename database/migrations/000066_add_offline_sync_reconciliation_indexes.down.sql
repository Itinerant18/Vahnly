DROP TABLE IF EXISTS driver_offline_sync_sessions;
DROP INDEX IF EXISTS idx_gps_trail_sync_reconcile;
ALTER TABLE orders_gps_trail 
DROP COLUMN IF EXISTS client_captured_at,
DROP COLUMN IF EXISTS is_synced_offline;
