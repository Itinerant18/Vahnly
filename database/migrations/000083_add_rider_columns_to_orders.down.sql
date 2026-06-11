DROP INDEX IF EXISTS idx_orders_rider;

ALTER TABLE orders
    DROP COLUMN IF EXISTS rider_id,
    DROP COLUMN IF EXISTS garage_car_id,
    DROP COLUMN IF EXISTS one_time_car_make,
    DROP COLUMN IF EXISTS one_time_car_model,
    DROP COLUMN IF EXISTS one_time_car_type,
    DROP COLUMN IF EXISTS one_time_car_transmission,
    DROP COLUMN IF EXISTS d4m_care_opted,
    DROP COLUMN IF EXISTS promo_code,
    DROP COLUMN IF EXISTS promo_discount_paise,
    DROP COLUMN IF EXISTS wallet_applied_paise,
    DROP COLUMN IF EXISTS payment_method,
    DROP COLUMN IF EXISTS rider_rating_for_driver,
    DROP COLUMN IF EXISTS rider_tip_paise,
    DROP COLUMN IF EXISTS rider_review_tags,
    DROP COLUMN IF EXISTS rider_review_comment,
    DROP COLUMN IF EXISTS trip_share_token,
    DROP COLUMN IF EXISTS trip_share_expires_at,
    DROP COLUMN IF EXISTS cancelled_by,
    DROP COLUMN IF EXISTS cancellation_reason,
    DROP COLUMN IF EXISTS sos_triggered_at,
    DROP COLUMN IF EXISTS ride_check_triggered_at;
