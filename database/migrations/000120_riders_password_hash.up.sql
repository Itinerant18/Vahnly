-- Rider phone+password login: nullable so existing OTP-only riders are unaffected.
ALTER TABLE riders ADD COLUMN IF NOT EXISTS password_hash text;
