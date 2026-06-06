-- Create marketing_segments table
CREATE TABLE IF NOT EXISTS marketing_segments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    filters JSONB NOT NULL DEFAULT '{}'::JSONB,
    size INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create marketing_campaigns table
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    segment_id INT REFERENCES marketing_segments(id) ON DELETE SET NULL,
    channel VARCHAR(50) NOT NULL, -- PUSH, SMS, EMAIL, IN_APP_BANNER, WHATSAPP
    schedule_type VARCHAR(50) NOT NULL, -- IMMEDIATE, SCHEDULED, RECURRING, TRIGGER_BASED
    schedule_time TIMESTAMP WITH TIME ZONE,
    recurrence_cron VARCHAR(50),
    trigger_event VARCHAR(100),
    throttling_limit INT,
    quiet_hours_start INT,
    quiet_hours_end INT,
    status VARCHAR(20) DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'PAUSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create campaign_variants table
CREATE TABLE IF NOT EXISTS campaign_variants (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    content JSONB NOT NULL DEFAULT '{}'::JSONB,
    weight DOUBLE PRECISION DEFAULT 1.0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create campaign_conversions table
CREATE TABLE IF NOT EXISTS campaign_conversions (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    variant_id INT REFERENCES campaign_variants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('RIDER', 'DRIVER')),
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('DELIVERED', 'OPENED', 'CLICKED', 'BOOKING')),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create in_app_banners table
CREATE TABLE IF NOT EXISTS in_app_banners (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    body TEXT NOT NULL,
    image_url TEXT,
    deep_link TEXT,
    placement VARCHAR(50) NOT NULL CHECK (placement IN ('HOME_SCREEN', 'BOOKING_CONFIRM', 'POST_TRIP')),
    segment_id INT REFERENCES marketing_segments(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create push_templates table
CREATE TABLE IF NOT EXISTS push_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    title_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    image_url TEXT,
    deep_link TEXT,
    variables TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create dlt_sms_templates table
CREATE TABLE IF NOT EXISTS dlt_sms_templates (
    id SERIAL PRIMARY KEY,
    sender_id VARCHAR(6) NOT NULL,
    dlt_template_id VARCHAR(50) UNIQUE NOT NULL,
    approved_content TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'APPROVED' NOT NULL CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create email_templates table
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create sender_domains table
CREATE TABLE IF NOT EXISTS sender_domains (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(100) UNIQUE NOT NULL,
    verified BOOLEAN DEFAULT false NOT NULL,
    dkim_status VARCHAR(20) DEFAULT 'PENDING' NOT NULL CHECK (dkim_status IN ('VERIFIED', 'PENDING', 'FAILED')),
    spf_status VARCHAR(20) DEFAULT 'PENDING' NOT NULL CHECK (spf_status IN ('VERIFIED', 'PENDING', 'FAILED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_variants_campaign ON campaign_variants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_conversions_campaign ON campaign_conversions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_in_app_banners_placement ON in_app_banners(placement);
CREATE INDEX IF NOT EXISTS idx_in_app_banners_status ON in_app_banners(status);

-- Seed initial data
DO $$
DECLARE
    v_segment_id_1 INT;
    v_segment_id_2 INT;
    v_campaign_id_1 INT;
    v_campaign_id_2 INT;
    v_variant_id_1a INT;
    v_variant_id_1b INT;
    v_rider_id UUID := '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c';
BEGIN
    -- Seed segments
    INSERT INTO marketing_segments (name, description, filters, size)
    VALUES (
        'Active Kolkata Riders',
        'Riders based in Kolkata who have completed more than 5 trips.',
        '{"city": "Kolkata", "min_trips": 5, "last_active_days": 14, "min_ltv_rupees": 1000}'::JSONB,
        2840
    ) RETURNING id INTO v_segment_id_1;

    INSERT INTO marketing_segments (name, description, filters, size)
    VALUES (
        'Inactive Premium Drivers',
        'Drivers with SUV vehicles who have not logged in for over 15 days.',
        '{"min_trips": 50, "last_active_days_min": 15, "car_type": "SUV", "transmission": "AUTOMATIC"}'::JSONB,
        142
    ) RETURNING id INTO v_segment_id_2;

    -- Seed campaigns
    INSERT INTO marketing_campaigns (name, segment_id, channel, schedule_type, schedule_time, status, throttling_limit, quiet_hours_start, quiet_hours_end)
    VALUES (
        'Monsoon Surge Push Blast',
        v_segment_id_1,
        'PUSH',
        'SCHEDULED',
        NOW() + INTERVAL '2 hours',
        'SCHEDULED',
        5000,
        22,
        8
    ) RETURNING id INTO v_campaign_id_1;

    INSERT INTO marketing_campaigns (name, segment_id, channel, schedule_type, status, trigger_event, throttling_limit, quiet_hours_start, quiet_hours_end)
    VALUES (
        'Post-Trip Re-engagement SMS',
        v_segment_id_1,
        'SMS',
        'TRIGGER_BASED',
        'ACTIVE',
        'POST_TRIP_COMPLETED',
        1000,
        21,
        9
    ) RETURNING id INTO v_campaign_id_2;

    -- Seed variants
    INSERT INTO campaign_variants (campaign_id, name, content, weight)
    VALUES (
        v_campaign_id_1,
        'Variant A (50% Off)',
        '{"title_template": "Raining Disocunts!", "body_template": "Hi {first_name}, beat the monsoon blues with 50% off your next 3 rides! Code: RAIN50", "deep_link": "d4m://promos/RAIN50"}'::JSONB,
        0.5
    ) RETURNING id INTO v_variant_id_1a;

    INSERT INTO campaign_variants (campaign_id, name, content, weight)
    VALUES (
        v_campaign_id_1,
        'Variant B (Flat Rs.100)',
        '{"title_template": "Monsoon Relief", "body_template": "Hi {first_name}, get flat ₹100 off your next trip. Safe travel assured. Code: DRY100", "deep_link": "d4m://promos/DRY100"}'::JSONB,
        0.5
    ) RETURNING id INTO v_variant_id_1b;

    -- Seed conversions for analysis visualization
    INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type, timestamp)
    VALUES (v_campaign_id_1, v_variant_id_1a, v_rider_id, 'RIDER', 'DELIVERED', NOW() - INTERVAL '1 hour');
    INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type, timestamp)
    VALUES (v_campaign_id_1, v_variant_id_1a, v_rider_id, 'RIDER', 'OPENED', NOW() - INTERVAL '45 minutes');
    INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type, timestamp)
    VALUES (v_campaign_id_1, v_variant_id_1a, v_rider_id, 'RIDER', 'CLICKED', NOW() - INTERVAL '30 minutes');
    INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type, timestamp)
    VALUES (v_campaign_id_1, v_variant_id_1a, v_rider_id, 'RIDER', 'BOOKING', NOW() - INTERVAL '15 minutes');

    INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type, timestamp)
    VALUES (v_campaign_id_1, v_variant_id_1b, v_rider_id, 'RIDER', 'DELIVERED', NOW() - INTERVAL '1 hour');
    INSERT INTO campaign_conversions (campaign_id, variant_id, user_id, user_type, action_type, timestamp)
    VALUES (v_campaign_id_1, v_variant_id_1b, v_rider_id, 'RIDER', 'OPENED', NOW() - INTERVAL '50 minutes');

    -- Seed In-App Banners
    INSERT INTO in_app_banners (title, body, image_url, deep_link, placement, segment_id, status, start_time, end_time)
    VALUES (
        'Weekend Safety Guarantee',
        'Travel worry-free with our 24/7 Safety Command Center backing you.',
        'https://platform-marketing-assets.s3.amazonaws.com/banners/safety_guarantee.png',
        'd4m://safety/features',
        'HOME_SCREEN',
        v_segment_id_1,
        'ACTIVE',
        NOW() - INTERVAL '1 day',
        NOW() + INTERVAL '30 days'
    );

    INSERT INTO in_app_banners (title, body, image_url, deep_link, placement, segment_id, status, start_time, end_time)
    VALUES (
        'Refer & Earn ₹500',
        'Invite your friends to try Drivers-for-u and earn credits on their first ride.',
        'https://platform-marketing-assets.s3.amazonaws.com/banners/referral_bonus.png',
        'd4m://referral/dashboard',
        'POST_TRIP',
        v_segment_id_1,
        'ACTIVE',
        NOW() - INTERVAL '2 days',
        NOW() + INTERVAL '10 days'
    );

    -- Seed templates
    INSERT INTO push_templates (name, title_template, body_template, image_url, deep_link, variables)
    VALUES (
        'Standard Promo Push',
        'Special Discount Just For You!',
        'Hey {first_name}, enjoy flat {discount_percent}% off your rides today. Use code {promo_code}.',
        'https://platform-marketing-assets.s3.amazonaws.com/push/gift_icon.png',
        'd4m://promos/{promo_code}',
        ARRAY['first_name', 'discount_percent', 'promo_code']
    );

    INSERT INTO dlt_sms_templates (sender_id, dlt_template_id, approved_content, status)
    VALUES (
        'DFUSMS',
        '1407161234567890123',
        'Your OTP for Drivers-for-u login is {#var#}. Do not share this with anyone.',
        'APPROVED'
    );

    INSERT INTO dlt_sms_templates (sender_id, dlt_template_id, approved_content, status)
    VALUES (
        'DFUSMS',
        '1407169876543210987',
        'Dear Customer, your ride with code {#var#} is scheduled. Thank you.',
        'APPROVED'
    );

    INSERT INTO email_templates (name, subject, html_content, variables)
    VALUES (
        'Welcome Newsletter',
        'Welcome to Drivers-for-u!',
        '<html><body><h1>Hi {first_name},</h1><p>Welcome to Drivers-for-u. Your account is active. Enjoy premium rides.</p></body></html>',
        ARRAY['first_name']
    );

    -- Seed domains
    INSERT INTO sender_domains (domain, verified, dkim_status, spf_status)
    VALUES (
        'driversforu.com',
        true,
        'VERIFIED',
        'VERIFIED'
    );

    INSERT INTO sender_domains (domain, verified, dkim_status, spf_status)
    VALUES (
        'marketing.driversforu.com',
        false,
        'PENDING',
        'PENDING'
    );

END$$;
