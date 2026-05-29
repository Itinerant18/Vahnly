-- Adds the ARRIVED_AT_PICKUP lifecycle state used by the trip-progress handlers
-- (HandleArriveAtPickup -> HandleStartTrip). Without it, every arrive/start-trip
-- UPDATE fails with "invalid input value for enum order_status_enum".
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'ARRIVED_AT_PICKUP' BEFORE 'DELIVERING';
