-- Store the plaintext pickup OTP alongside otp_hash so the rider live-trip screen
-- can recover the OTP on cold start (the hash alone cannot be reversed for display).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_pickup_otp VARCHAR(6);
