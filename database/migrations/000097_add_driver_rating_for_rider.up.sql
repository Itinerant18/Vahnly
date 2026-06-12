-- Driver→rider rating: the rating a driver leaves for a rider after a completed trip.
-- Distinct from rider_rating_for_driver (the rider's rating OF the driver, which feeds
-- the drivers.rating aggregate). Additive only; uses IF NOT EXISTS so it is safe to re-run.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS driver_rating_for_rider SMALLINT
        CHECK (driver_rating_for_rider BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS driver_review_tags TEXT[],
    ADD COLUMN IF NOT EXISTS driver_review_comment TEXT;
