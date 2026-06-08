-- Add OTP hash, wait timer, and OTP failure lockout counters to orders.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS waiting_started_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS otp_attempts INT DEFAULT 0;

-- Backfill existing orders with a default SHA-256 hash of "1234":
-- "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"
UPDATE orders
SET otp_hash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
WHERE otp_hash IS NULL;
