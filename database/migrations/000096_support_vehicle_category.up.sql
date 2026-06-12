-- Driver app surfaces a dedicated "Vehicle" support category; the existing check
-- constraint didn't allow it (tickets were forced into OTHER). Extend the allow-list.
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_category_check
    CHECK (category IN ('TRIP','PAYMENT','DRIVER_BEHAVIOR','LOST_ITEM','ACCOUNT','SAFETY','OTHER','VEHICLE'));
