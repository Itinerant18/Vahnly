-- Phase 1: Onboarding & Auth - KYC Documents Vault
-- Stores references to uploaded identity verification documents
CREATE TABLE IF NOT EXISTS driver_kyc_documents (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id),
    dl_front_url TEXT,
    dl_back_url TEXT,
    aadhaar_url TEXT,
    pan_url TEXT,
    police_verification_url TEXT,
    verification_status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, VERIFIED, REJECTED
    admin_reviewer_id UUID,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Phase 1: Onboarding & Auth - Bank Payout Details
-- Stores bank account information for driver payout settlement
CREATE TABLE IF NOT EXISTS driver_bank_details (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id),
    account_number TEXT NOT NULL,
    ifsc_code VARCHAR(11) NOT NULL,
    holder_name TEXT NOT NULL,
    upi_id TEXT,
    cancelled_cheque_url TEXT,
    verified BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add onboarding-specific profile enrichment columns to drivers table
-- NOTE: onboarding_step, onboarding_data, verification_status already exist from migration 000035
-- NOTE: terms_accepted_at, terms_version, terms_ip_address already exist from migration 000062
ALTER TABLE drivers
ADD COLUMN IF NOT EXISTS transmission_manual BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS transmission_automatic BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS years_of_experience INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
ADD COLUMN IF NOT EXISTS quiz_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS quiz_passed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS permanent_address TEXT,
ADD COLUMN IF NOT EXISTS current_address TEXT;
