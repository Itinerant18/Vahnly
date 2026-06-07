-- Create safety_sos_alerts table
CREATE TABLE IF NOT EXISTS safety_sos_alerts (
    id VARCHAR(50) PRIMARY KEY,
    trip_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    reporter_type VARCHAR(20) NOT NULL CHECK (reporter_type IN ('RIDER', 'DRIVER')),
    status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')),
    assigned_agent_id UUID REFERENCES system_admins(id) ON DELETE SET NULL,
    audio_stream_url TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    emergency_contacts_notified BOOLEAN DEFAULT false NOT NULL,
    authorities_dispatched BOOLEAN DEFAULT false NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create safety_incidents table
CREATE TABLE IF NOT EXISTS safety_incidents (
    id VARCHAR(50) PRIMARY KEY,
    sos_alert_id VARCHAR(50) REFERENCES safety_sos_alerts(id) ON DELETE SET NULL,
    trip_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    category VARCHAR(30) NOT NULL CHECK (category IN ('ACCIDENT', 'HARASSMENT', 'THEFT', 'RASH_DRIVING', 'VEHICLE_ISSUE', 'OTHER')),
    reporter_id UUID NOT NULL,
    reporter_type VARCHAR(20) NOT NULL CHECK (reporter_type IN ('RIDER', 'DRIVER', 'SYSTEM')),
    description TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'OPEN' NOT NULL CHECK (status IN ('OPEN', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED')),
    evidence_urls TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
    outcome_type VARCHAR(30) CHECK (outcome_type IN ('WARNING', 'SUSPENSION', 'BAN', 'POLICE_CASE', 'INSURANCE_CLAIM', 'NO_ACTION')),
    outcome_details TEXT,
    d4m_care_claim_id VARCHAR(50),
    d4m_care_claim_status VARCHAR(30) DEFAULT 'NOT_FILED' NOT NULL CHECK (d4m_care_claim_status IN ('NOT_FILED', 'FILED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    d4m_care_claim_amount_paise BIGINT DEFAULT 0 NOT NULL,
    assigned_agent_id UUID REFERENCES system_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create ride_check_anomalies table
CREATE TABLE IF NOT EXISTS ride_check_anomalies (
    id SERIAL PRIMARY KEY,
    trip_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    anomaly_type VARCHAR(30) NOT NULL CHECK (anomaly_type IN ('LONG_STOP', 'OFF_ROUTE', 'SUDDEN_SPEED_CHANGE')),
    description TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'MEDIUM' NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status VARCHAR(20) DEFAULT 'PENDING' NOT NULL CHECK (status IN ('PENDING', 'DISMISSED', 'ESCALATED_TO_SOS')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create safety_blacklist table
CREATE TABLE IF NOT EXISTS safety_blacklist (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('RIDER', 'DRIVER')),
    block_type VARCHAR(20) NOT NULL CHECK (block_type IN ('GLOBAL', 'MUTUAL')),
    target_user_id UUID,
    target_user_type VARCHAR(20) CHECK (target_user_type IN ('RIDER', 'DRIVER')),
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by UUID REFERENCES system_admins(id) ON DELETE SET NULL
);

-- Create indices
CREATE INDEX IF NOT EXISTS idx_safety_sos_alerts_status ON safety_sos_alerts(status);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_category ON safety_incidents(category);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_status ON safety_incidents(status);
CREATE INDEX IF NOT EXISTS idx_ride_check_anomalies_type ON ride_check_anomalies(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_safety_blacklist_user ON safety_blacklist(user_id);

-- Seed initial data
DO $$
DECLARE
    v_admin_id UUID;
    v_trip_id UUID;
    v_rider_id UUID := '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c';
    v_driver_id UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    v_driver_id_2 UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
BEGIN
    SELECT id INTO v_admin_id FROM system_admins WHERE email = 'aniketkarmakar018@gmail.com' LIMIT 1;
    SELECT id INTO v_trip_id FROM orders LIMIT 1;

    IF v_trip_id IS NOT NULL THEN
        -- SOS Alert
        INSERT INTO safety_sos_alerts (id, trip_id, reporter_type, status, assigned_agent_id, audio_stream_url, latitude, longitude, emergency_contacts_notified, authorities_dispatched, notes, created_at, updated_at)
        VALUES (
            'SOS-10001',
            v_trip_id,
            'RIDER',
            'ACTIVE',
            v_admin_id,
            'https://platform-safety-recordings.s3.amazonaws.com/sos/SOS-10001.mp3',
            22.5726,
            88.3639,
            true,
            false,
            'Rider reported aggressive behaviour and vehicle speeding.',
            NOW() - INTERVAL '10 minutes',
            NOW() - INTERVAL '10 minutes'
        ) ON CONFLICT (id) DO NOTHING;

        -- Resolved SOS Alert
        INSERT INTO safety_sos_alerts (id, trip_id, reporter_type, status, assigned_agent_id, audio_stream_url, latitude, longitude, emergency_contacts_notified, authorities_dispatched, notes, created_at, updated_at, resolved_at)
        VALUES (
            'SOS-10002',
            v_trip_id,
            'DRIVER',
            'RESOLVED',
            v_admin_id,
            NULL,
            22.5832,
            88.3678,
            false,
            true,
            'Driver vehicle collided with guardrail. Authorities dispatched immediately. Handled.',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '23 hours',
            NOW() - INTERVAL '23 hours'
        ) ON CONFLICT (id) DO NOTHING;

        -- Accident Incident with Claim
        INSERT INTO safety_incidents (id, sos_alert_id, trip_id, category, reporter_id, reporter_type, description, status, evidence_urls, outcome_type, outcome_details, d4m_care_claim_id, d4m_care_claim_status, d4m_care_claim_amount_paise, assigned_agent_id, created_at, updated_at)
        VALUES (
            'INC-20001',
            'SOS-10002',
            v_trip_id,
            'ACCIDENT',
            v_driver_id,
            'DRIVER',
            'Minor front bumper collision with a guardrail while turning. No injuries reported.',
            'UNDER_INVESTIGATION',
            ARRAY['https://platform-safety-recordings.s3.amazonaws.com/incidents/bumper_dent_1.jpg', 'https://platform-safety-recordings.s3.amazonaws.com/incidents/bumper_dent_2.jpg'],
            NULL,
            NULL,
            'CLM-30001',
            'FILED',
            1850000, -- ₹18,500.00
            v_admin_id,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
        ) ON CONFLICT (id) DO NOTHING;

        -- Harassment Incident (Resolved with ban)
        INSERT INTO safety_incidents (id, sos_alert_id, trip_id, category, reporter_id, reporter_type, description, status, evidence_urls, outcome_type, outcome_details, d4m_care_claim_id, d4m_care_claim_status, d4m_care_claim_amount_paise, assigned_agent_id, created_at, updated_at, resolved_at)
        VALUES (
            'INC-20002',
            'SOS-10001',
            v_trip_id,
            'HARASSMENT',
            v_rider_id,
            'RIDER',
            'Driver made multiple highly inappropriate comments and refused to stop vehicle initially.',
            'RESOLVED',
            ARRAY['https://platform-safety-recordings.s3.amazonaws.com/incidents/harassment_audio.mp3'],
            'BAN',
            'Driver was verified to have violated harassment policies via audio evidence. Banned from matching.',
            NULL,
            'NOT_FILED',
            0,
            v_admin_id,
            NOW() - INTERVAL '2 hours',
            NOW() - INTERVAL '30 minutes',
            NOW() - INTERVAL '30 minutes'
        ) ON CONFLICT (id) DO NOTHING;

        -- Anomalies
        INSERT INTO ride_check_anomalies (trip_id, anomaly_type, description, severity, latitude, longitude, status, created_at)
        VALUES (
            v_trip_id,
            'LONG_STOP',
            'Vehicle remained stationary for 8 minutes in a high-traffic zone without progress.',
            'MEDIUM',
            22.5712,
            88.3621,
            'PENDING',
            NOW() - INTERVAL '15 minutes'
        );

        INSERT INTO ride_check_anomalies (trip_id, anomaly_type, description, severity, latitude, longitude, status, created_at)
        VALUES (
            v_trip_id,
            'OFF_ROUTE',
            'Vehicle deviated by 1.2km from the expected OSRM routing profile.',
            'HIGH',
            22.5855,
            88.3590,
            'PENDING',
            NOW() - INTERVAL '5 minutes'
        );
    END IF;

    -- Blacklist Seed
    INSERT INTO safety_blacklist (user_id, user_type, block_type, target_user_id, target_user_type, reason, created_at, created_by)
    VALUES (
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', -- Ramesh Sen
        'DRIVER',
        'GLOBAL',
        NULL,
        NULL,
        'Repeated rash driving complaints and safety protocol violations.',
        NOW() - INTERVAL '3 days',
        v_admin_id
    );

    INSERT INTO safety_blacklist (user_id, user_type, block_type, target_user_id, target_user_type, reason, created_at, created_by)
    VALUES (
        v_driver_id_2, -- Joydev Chatterjee
        'DRIVER',
        'MUTUAL',
        v_rider_id,
        'RIDER',
        'Mutual block requested by rider after verbal altercation.',
        NOW() - INTERVAL '2 hours',
        v_admin_id
    );

END$$;
