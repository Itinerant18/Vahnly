ALTER TABLE orders
    DROP COLUMN IF EXISTS driver_rating_for_rider,
    DROP COLUMN IF EXISTS driver_review_tags,
    DROP COLUMN IF EXISTS driver_review_comment;
