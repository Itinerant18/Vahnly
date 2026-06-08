-- Drop the OTP hash, wait timer, and OTP failure lockout counters.
ALTER TABLE orders
    DROP COLUMN IF EXISTS otp_hash,
    DROP COLUMN IF EXISTS waiting_started_at,
    DROP COLUMN IF EXISTS otp_attempts;
