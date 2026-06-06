-- Central documents vault for all uploaded files across the platform
CREATE TABLE IF NOT EXISTS documents_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('DRIVER', 'RIDER', 'VEHICLE', 'ORDER', 'SYSTEM')),
    entity_id VARCHAR(100) NOT NULL,
    doc_type VARCHAR(50) NOT NULL CHECK (doc_type IN (
        'DRIVING_LICENSE', 'RC_BOOK', 'INSURANCE', 'PUC',
        'ID_PROOF', 'ADDRESS_PROOF', 'KYC_SELFIE', 'BACKGROUND_CHECK',
        'TRIP_INVOICE', 'GST_INVOICE', 'OTHER'
    )),
    display_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_size_bytes INT DEFAULT 0 NOT NULL,
    mime_type VARCHAR(100) DEFAULT 'application/pdf' NOT NULL,
    version INT DEFAULT 1 NOT NULL,
    tags VARCHAR(50)[] DEFAULT '{}'::VARCHAR(50)[] NOT NULL,
    expiry_date DATE,
    uploaded_by_email VARCHAR(255) DEFAULT '' NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'SUPERSEDED', 'DELETED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents_vault(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents_vault(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents_vault(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents_vault(status);

-- Access log for documents (who viewed/downloaded what)
CREATE TABLE IF NOT EXISTS documents_access_log (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents_vault(id) ON DELETE CASCADE,
    accessed_by_email VARCHAR(255) NOT NULL,
    access_type VARCHAR(20) NOT NULL CHECK (access_type IN ('VIEW', 'DOWNLOAD', 'UPLOAD', 'TAG', 'DELETE', 'ARCHIVE')),
    ip_address VARCHAR(45) DEFAULT '' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_access_log_doc ON documents_access_log(document_id);

-- GDPR / DPDP privacy requests
CREATE TABLE IF NOT EXISTS privacy_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type VARCHAR(30) NOT NULL CHECK (request_type IN ('DATA_EXPORT', 'DATA_DELETE', 'CONSENT_WITHDRAWAL', 'RECTIFICATION')),
    requester_type VARCHAR(20) NOT NULL CHECK (requester_type IN ('RIDER', 'DRIVER')),
    requester_id UUID NOT NULL,
    requester_email VARCHAR(255) NOT NULL,
    requester_phone VARCHAR(20) DEFAULT '' NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED')),
    notes TEXT DEFAULT '' NOT NULL,
    rejection_reason TEXT,
    processed_by_email VARCHAR(255),
    completed_at TIMESTAMP WITH TIME ZONE,
    deadline_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests(status);

-- Seed sample documents for the two known drivers
INSERT INTO documents_vault (entity_type, entity_id, doc_type, display_name, file_url, file_size_bytes, mime_type, tags, expiry_date, uploaded_by_email)
VALUES
    ('DRIVER', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'DRIVING_LICENSE', 'DL – Subir Das',      'https://docs.driversfor-u.in/kyc/dl_subir_das.pdf',     524288,  'application/pdf', ARRAY['kyc','approved'],   '2028-04-15', 'kyc-bot@system'),
    ('DRIVER', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'KYC_SELFIE',      'Selfie – Subir Das',  'https://docs.driversfor-u.in/kyc/selfie_subir_das.jpg', 204800,  'image/jpeg',      ARRAY['kyc','approved'],   NULL,         'kyc-bot@system'),
    ('DRIVER', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'INSURANCE',       'Insurance – WB02AK',  'https://docs.driversfor-u.in/vehicle/insurance_wb02ak.pdf', 786432, 'application/pdf', ARRAY['vehicle','expiring'],'2026-09-01', 'kyc-bot@system'),
    ('DRIVER', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'DRIVING_LICENSE', 'DL – Joydev Chatterjee', 'https://docs.driversfor-u.in/kyc/dl_joydev.pdf',     450000,  'application/pdf', ARRAY['kyc','approved'],   '2027-11-30', 'kyc-bot@system'),
    ('DRIVER', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'DRIVING_LICENSE', 'DL – Ramesh Sen',     'https://docs.driversfor-u.in/kyc/dl_ramesh.pdf',        512000,  'application/pdf', ARRAY['kyc','pending'],    '2026-07-22', 'kyc-bot@system'),
    ('DRIVER', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'RC_BOOK',         'RC – Ramesh MH12',    'https://docs.driversfor-u.in/vehicle/rc_mh12.pdf',      360000,  'application/pdf', ARRAY['vehicle'],          '2026-06-30', 'kyc-bot@system'),
    ('SYSTEM', 'platform',                              'GST_INVOICE',     'GST Invoice May 2026','https://docs.driversfor-u.in/invoices/gst_may26.pdf',   1048576, 'application/pdf', ARRAY['finance','gst'],    NULL,         'finance-bot@system')
ON CONFLICT DO NOTHING;

-- Seed a privacy request
INSERT INTO privacy_requests (request_type, requester_type, requester_id, requester_email, requester_phone, deadline_at)
VALUES (
    'DATA_EXPORT', 'RIDER',
    '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
    'sarah.connor@example.com', '+91 9999912345',
    CURRENT_TIMESTAMP + INTERVAL '30 days'
) ON CONFLICT DO NOTHING;
