-- Pre-clean: if historical data already holds multiple active orders for one
-- rider, cancel all but the newest so the unique index below can build.
UPDATE orders o
SET status = 'CANCELLED'::order_status_enum,
    cancelled_by = 'SYSTEM',
    cancellation_reason = 'duplicate_active_order_cleanup'
WHERE o.rider_id IS NOT NULL
  AND o.status NOT IN ('COMPLETED'::order_status_enum, 'CANCELLED'::order_status_enum)
  AND EXISTS (
      SELECT 1 FROM orders n
      WHERE n.rider_id = o.rider_id
        AND n.status NOT IN ('COMPLETED'::order_status_enum, 'CANCELLED'::order_status_enum)
        AND n.created_at > o.created_at
  );

-- One active order per rider, enforced at the database. The service-level
-- GetActiveOrderID check is TOCTOU: two concurrent CreateOrder calls (a
-- double-tap) can both pass it and insert two live orders → two dispatches.
-- Predicate mirrors repository.activeOrderPredicate. rider_id IS NOT NULL
-- keeps legacy/platform orders (no rider) out of the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_one_active_per_rider
    ON orders (rider_id)
    WHERE rider_id IS NOT NULL
      AND status NOT IN ('COMPLETED'::order_status_enum, 'CANCELLED'::order_status_enum);
