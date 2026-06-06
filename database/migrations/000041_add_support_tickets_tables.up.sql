-- Create support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
    id VARCHAR(50) PRIMARY KEY,
    creator_id UUID NOT NULL,
    creator_type VARCHAR(20) NOT NULL CHECK (creator_type IN ('RIDER', 'DRIVER')),
    creator_name VARCHAR(100) NOT NULL,
    creator_phone VARCHAR(20) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('CHAT', 'EMAIL', 'PHONE', 'SOS')),
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'MEDIUM' NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status VARCHAR(20) DEFAULT 'OPEN' NOT NULL CHECK (status IN ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED')),
    category VARCHAR(30) DEFAULT 'OTHER' NOT NULL CHECK (category IN ('TRIP', 'PAYMENT', 'DRIVER_BEHAVIOR', 'LOST_ITEM', 'ACCOUNT', 'SAFETY', 'OTHER')),
    assigned_agent_id UUID REFERENCES system_admins(id) ON DELETE SET NULL,
    tags VARCHAR(50)[] DEFAULT '{}'::VARCHAR(50)[] NOT NULL,
    sla_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    escalated_to VARCHAR(30),
    linked_trip_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    resolution_type VARCHAR(30),
    resolution_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Create ticket_messages table
CREATE TABLE IF NOT EXISTS ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL,
    sender_name VARCHAR(100) NOT NULL,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('AGENT', 'USER', 'SYSTEM')),
    message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('CHAT', 'EMAIL', 'CALL_NOTE', 'INTERNAL_NOTE')),
    content TEXT NOT NULL,
    attachment_urls TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create lost_found_items table
CREATE TABLE IF NOT EXISTS lost_found_items (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) REFERENCES support_tickets(id) ON DELETE SET NULL,
    trip_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL,
    reporter_type VARCHAR(20) NOT NULL CHECK (reporter_type IN ('RIDER', 'DRIVER')),
    item_description TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'REPORTED' NOT NULL CHECK (status IN ('REPORTED', 'FOUND', 'RETURNED', 'CLOSED')),
    driver_contacted BOOLEAN DEFAULT false NOT NULL,
    return_tracking_code VARCHAR(100),
    return_method VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create support_macros table
CREATE TABLE IF NOT EXISTS support_macros (
    shortcut_code VARCHAR(50) PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    title VARCHAR(100) NOT NULL,
    template_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create faq_articles table
CREATE TABLE IF NOT EXISTS faq_articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PUBLISHED' NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create ticket_csat table
CREATE TABLE IF NOT EXISTS ticket_csat (
    ticket_id VARCHAR(50) PRIMARY KEY REFERENCES support_tickets(id) ON DELETE CASCADE,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indices
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_agent ON support_tickets(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_sla ON support_tickets(sla_deadline);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_lost_found_items_trip ON lost_found_items(trip_id);

-- Seed Macros
INSERT INTO support_macros (shortcut_code, category, title, template_text) VALUES
('greet_customer', 'General', 'Standard Agent Greeting', 'Hello {{name}}, thank you for contacting Drivers-for-U support. My name is {{agent_name}}, and I will be assisting you today. How can I help you?'),
('fare_refunded', 'Billing', 'Refund Confirmation', 'Hello {{name}}, we have reviewed your trip details and processed a full refund of ₹{{refund_amount}} for your ride. The amount should reflect in your wallet/original payment source in 3-5 business days.'),
('lost_item_found', 'Lost & Found', 'Item Found and Tracking', 'Great news {{name}}! The driver has located your lost item ({{item_name}}) in the vehicle. We have arranged for it to be returned via {{return_method}}. Your tracking code is {{tracking_code}}.'),
('safety_escalate', 'Safety', 'Safety Escalation Warning', 'Hello {{name}}, we take safety reports extremely seriously. I am immediately escalating your ticket to our specialized Incident Response & L2 Safety Team. An investigator will contact you directly within 15 minutes.')
ON CONFLICT (shortcut_code) DO NOTHING;

-- Seed FAQs
INSERT INTO faq_articles (title, category, content, status) VALUES
('How do I report an item left in the vehicle?', 'Lost & Found', 'If you left a personal item in a vehicle, navigate to the Support tab, select "Report Lost Item", choose the specific trip, and describe your item. We will contact the driver immediately.', 'PUBLISHED'),
('Why was I charged a surge price multiplier?', 'Pricing', 'Surge pricing is automatically activated when driver demand exceeds available supply in a specific zone. This incentivizes more drivers to log online, stabilizing matching times.', 'PUBLISHED'),
('What should I do during an emergency?', 'Safety', 'If you feel unsafe or are in an emergency, tap the in-app SOS button. This immediately sends your live GPS coordinates, vehicle plate, and driver info to local emergency services and alerts our 24/7 Safety Command Center.', 'PUBLISHED')
ON CONFLICT DO NOTHING;

-- Seed Support Tickets and messages
DO $$
DECLARE
    v_admin_id UUID;
    v_trip_id UUID;
    v_rider_id UUID := '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c';
    v_driver_id UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
BEGIN
    -- Get seeded admin ID
    SELECT id INTO v_admin_id FROM system_admins WHERE email = 'aniketkarmakar018@gmail.com' LIMIT 1;
    -- Get seeded trip ID
    SELECT id INTO v_trip_id FROM orders LIMIT 1;

    -- 1. SOS Safety ticket (breached SLA)
    INSERT INTO support_tickets (id, creator_id, creator_type, creator_name, creator_phone, channel, subject, description, priority, status, category, assigned_agent_id, tags, sla_deadline, escalated_to, linked_trip_id, created_at, updated_at)
    VALUES (
        'TKT-10001',
        v_rider_id,
        'RIDER',
        'Sarah Connor',
        '+91 9999912345',
        'SOS',
        'Emergency SOS Triggered - High Speed Alert',
        'Rider pressed the emergency SOS button during trip. GPS telemetry shows speed exceeding 120 km/h in urban grid.',
        'URGENT',
        'OPEN',
        'SAFETY',
        v_admin_id,
        ARRAY['sos', 'safety-breach'],
        NOW() - INTERVAL '1 hour',
        'SAFETY',
        v_trip_id,
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '2 hours'
    ) ON CONFLICT (id) DO NOTHING;

    -- Insert conversation messages for TKT-10001
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, created_at) VALUES
    ('TKT-10001', v_rider_id, 'Sarah Connor', 'USER', 'CHAT', 'SOS button triggered. Driver is driving extremely recklessly!', NOW() - INTERVAL '2 hours'),
    ('TKT-10001', '00000000-0000-0000-0000-000000000000'::UUID, 'System matching engine', 'SYSTEM', 'INTERNAL_NOTE', 'SOS automatic warning broadcasted to operations logs.', NOW() - INTERVAL '1 hour 58 minutes'),
    ('TKT-10001', v_admin_id, 'Aniket karmakar', 'AGENT', 'INTERNAL_NOTE', 'Called the customer. Line busy. Re-trying now.', NOW() - INTERVAL '1 hour 30 minutes')
    ON CONFLICT DO NOTHING;

    -- 2. Billing / Refund Ticket (Pending status)
    INSERT INTO support_tickets (id, creator_id, creator_type, creator_name, creator_phone, channel, subject, description, priority, status, category, assigned_agent_id, tags, sla_deadline, created_at, updated_at)
    VALUES (
        'TKT-10002',
        v_driver_id,
        'DRIVER',
        'Joydev Chatterjee',
        '+919876543222',
        'EMAIL',
        'Disputed Commission Deduction on Ride',
        'Driver reports commission fee deducted was 25% instead of the promotional 10% rate.',
        'HIGH',
        'PENDING',
        'PAYMENT',
        v_admin_id,
        ARRAY['billing', 'promo-commission'],
        NOW() + INTERVAL '2 hours',
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '10 minutes'
    ) ON CONFLICT (id) DO NOTHING;

    -- Insert conversation messages for TKT-10002
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_type, message_type, content, created_at) VALUES
    ('TKT-10002', v_driver_id, 'Joydev Chatterjee', 'USER', 'EMAIL', 'Please check ride order ID #ord-9011-cb72. I was deducted ₹250 instead of ₹100.', NOW() - INTERVAL '2 hours'),
    ('TKT-10002', v_admin_id, 'Aniket karmakar', 'AGENT', 'EMAIL', 'Hi Joydev, looking into this now. Checking the promotion ledger entries.', NOW() - INTERVAL '15 minutes')
    ON CONFLICT DO NOTHING;

    -- 3. Driver behavior ticket (RESOLVED)
    INSERT INTO support_tickets (id, creator_id, creator_type, creator_name, creator_phone, channel, subject, description, priority, status, category, assigned_agent_id, tags, sla_deadline, resolution_type, resolution_reason, created_at, updated_at)
    VALUES (
        'TKT-10003',
        v_rider_id,
        'RIDER',
        'Aarav Sharma',
        '+91 9999923456',
        'CHAT',
        'Driver refused to turn on AC',
        'Customer reports driver was rude and refused to turn on air conditioning during hot day.',
        'MEDIUM',
        'RESOLVED',
        'DRIVER_BEHAVIOR',
        v_admin_id,
        ARRAY['ac-dispute', 'driver-behavior'],
        NOW() + INTERVAL '22 hours',
        'VOUCHER',
        'Sent ₹100 discount coupon to the customer and issued warning to driver.',
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '30 minutes'
    ) ON CONFLICT (id) DO NOTHING;

    -- 4. Lost & Found Ticket (CLOSED)
    INSERT INTO support_tickets (id, creator_id, creator_type, creator_name, creator_phone, channel, subject, description, priority, status, category, assigned_agent_id, tags, sla_deadline, resolution_type, resolution_reason, created_at, updated_at, closed_at)
    VALUES (
        'TKT-10004',
        v_rider_id,
        'RIDER',
        'Deepa Nair',
        '+91 9999934567',
        'PHONE',
        'Forgot iPhone 14 in the back seat',
        'Rider states she left her blue iPhone 14 in the vehicle. Needs driver contact.',
        'LOW',
        'CLOSED',
        'LOST_ITEM',
        v_admin_id,
        ARRAY['lost-and-found', 'iphone'],
        NOW() + INTERVAL '70 hours',
        'MESSAGE',
        'Item returned via courier tracking code #DEL-92839218.',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
    ) ON CONFLICT (id) DO NOTHING;

    -- Seed CSAT for TKT-10004
    INSERT INTO ticket_csat (ticket_id, rating, comment) VALUES
    ('TKT-10004', 5, 'Quick support! I got my phone back within 24 hours.')
    ON CONFLICT DO NOTHING;

    -- Seed Lost & Found item for TKT-10004
    INSERT INTO lost_found_items (ticket_id, trip_id, reporter_id, reporter_type, item_description, status, driver_contacted, return_tracking_code, return_method, notes, created_at, updated_at)
    VALUES (
        'TKT-10004',
        v_trip_id,
        v_rider_id,
        'RIDER',
        'Blue iPhone 14 with a red silicone case',
        'RETURNED',
        true,
        'DEL-92839218',
        'Blue Dart Courier',
        'Item recovered from back seat. Driver handed over to Blue Dart branch sector V.',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '1 day'
    ) ON CONFLICT DO NOTHING;

END$$;
