-- CMS pages (Terms, Privacy, Help, Onboarding, etc.)
CREATE TABLE IF NOT EXISTS cms_pages (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    page_type VARCHAR(30) NOT NULL CHECK (page_type IN ('POLICY', 'FAQ', 'HELP_ARTICLE', 'ONBOARDING', 'BANNER', 'SPLASH')),
    status VARCHAR(20) DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    min_app_version VARCHAR(20) DEFAULT '' NOT NULL,
    created_by_email VARCHAR(255) DEFAULT '' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE
);

-- Versioned content per page per language
CREATE TABLE IF NOT EXISTS cms_content_versions (
    id SERIAL PRIMARY KEY,
    page_id INT NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
    language_code VARCHAR(10) DEFAULT 'en' NOT NULL,
    content_body TEXT NOT NULL,
    version INT DEFAULT 1 NOT NULL,
    is_current BOOLEAN DEFAULT true NOT NULL,
    created_by_email VARCHAR(255) DEFAULT '' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cms_content_page_lang ON cms_content_versions(page_id, language_code, is_current);

-- i18n key-value strings for in-app text
CREATE TABLE IF NOT EXISTS i18n_strings (
    id SERIAL PRIMARY KEY,
    key_name VARCHAR(255) NOT NULL,
    namespace VARCHAR(100) DEFAULT 'common' NOT NULL,
    language_code VARCHAR(10) DEFAULT 'en' NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_by_email VARCHAR(255) DEFAULT '' NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE (key_name, namespace, language_code)
);

CREATE INDEX IF NOT EXISTS idx_i18n_namespace_lang ON i18n_strings(namespace, language_code);

-- App store / onboarding assets
CREATE TABLE IF NOT EXISTS cms_assets (
    id SERIAL PRIMARY KEY,
    asset_type VARCHAR(30) NOT NULL CHECK (asset_type IN ('SPLASH_SCREEN', 'ONBOARDING_SLIDE', 'APP_STORE_SCREENSHOT', 'APP_ICON', 'BANNER')),
    platform VARCHAR(20) DEFAULT 'ALL' NOT NULL CHECK (platform IN ('iOS', 'ANDROID', 'ALL')),
    title VARCHAR(255) DEFAULT '' NOT NULL,
    file_url TEXT NOT NULL,
    thumbnail_url TEXT DEFAULT '' NOT NULL,
    min_app_version VARCHAR(20) DEFAULT '' NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT')),
    display_order INT DEFAULT 0 NOT NULL,
    created_by_email VARCHAR(255) DEFAULT '' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Seed default CMS pages
INSERT INTO cms_pages (slug, title, page_type, status, created_by_email) VALUES
    ('terms-and-conditions',   'Terms and Conditions',   'POLICY',       'PUBLISHED', 'system'),
    ('privacy-policy',         'Privacy Policy',          'POLICY',       'PUBLISHED', 'system'),
    ('cancellation-policy',    'Cancellation Policy',     'POLICY',       'PUBLISHED', 'system'),
    ('refund-policy',          'Refund Policy',           'POLICY',       'PUBLISHED', 'system'),
    ('driver-onboarding-1',    'Welcome to Drivers-for-U','ONBOARDING',   'PUBLISHED', 'system'),
    ('driver-onboarding-2',    'How Trips Work',          'ONBOARDING',   'PUBLISHED', 'system'),
    ('driver-onboarding-3',    'Earnings & Payouts',      'ONBOARDING',   'PUBLISHED', 'system'),
    ('help-sos',               'SOS & Emergency Help',    'HELP_ARTICLE', 'PUBLISHED', 'system'),
    ('faq-general',            'General FAQs',            'FAQ',          'PUBLISHED', 'system')
ON CONFLICT (slug) DO NOTHING;

-- Seed content for Terms
INSERT INTO cms_content_versions (page_id, language_code, content_body, version, is_current, created_by_email)
SELECT id, 'en',
'# Terms and Conditions

**Last updated: June 2026**

By using Drivers-for-U you agree to these terms.

## 1. Service Usage
- Platform connects riders with drivers for transportation services.
- Users must be 18+ years of age.
- Accurate registration information is required.

## 2. Payments
- Fare is calculated per trip and shown before booking.
- Surge pricing applies during high demand.
- Payments via UPI, card, or wallet.

## 3. Cancellation
- Free cancellation within 3 minutes of booking.
- Cancellation fee applies thereafter.

## 4. Safety
- SOS button available during every trip.
- All drivers are background-checked.',
1, true, 'system'
FROM cms_pages WHERE slug = 'terms-and-conditions' LIMIT 1;

-- Seed i18n strings (English + Hindi)
INSERT INTO i18n_strings (key_name, namespace, language_code, value, description, updated_by_email) VALUES
    ('book_a_ride',      'booking', 'en', 'Book a Ride',        'Home screen primary CTA',   'system'),
    ('book_a_ride',      'booking', 'hi', 'राइड बुक करें',       'Home screen primary CTA',   'system'),
    ('book_a_ride',      'booking', 'bn', 'রাইড বুক করুন',      'Home screen primary CTA',   'system'),
    ('finding_driver',   'booking', 'en', 'Finding your driver…','Matching loading state',    'system'),
    ('finding_driver',   'booking', 'hi', 'ड्राइवर खोज रहे हैं…','Matching loading state',  'system'),
    ('trip_started',     'trip',    'en', 'Trip Started',        'Trip started status',       'system'),
    ('trip_started',     'trip',    'hi', 'यात्रा शुरू हो गई',   'Trip started status',       'system'),
    ('trip_completed',   'trip',    'en', 'Trip Completed',      'Trip complete state',       'system'),
    ('trip_completed',   'trip',    'hi', 'यात्रा पूरी हो गई',   'Trip complete state',       'system'),
    ('emergency_sos',    'safety',  'en', 'Emergency SOS',       'SOS button label',          'system'),
    ('emergency_sos',    'safety',  'hi', 'आपातकालीन SOS',       'SOS button label',          'system'),
    ('rate_your_trip',   'rating',  'en', 'Rate your trip',      'Post-trip rating prompt',   'system'),
    ('rate_your_trip',   'rating',  'hi', 'अपनी यात्रा रेट करें', 'Post-trip rating prompt', 'system')
ON CONFLICT (key_name, namespace, language_code) DO NOTHING;
