-- P3: "owner not in car" bookings — the rider sends the car with the driver but doesn't
-- ride along (drop kids, fetch someone). Surfaced to the driver pre-accept (different trust
-- expectation) and on the trip screen.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS owner_not_in_car BOOLEAN NOT NULL DEFAULT false;
