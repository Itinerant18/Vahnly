-- Drop indexes
DROP INDEX IF EXISTS idx_in_app_banners_status;
DROP INDEX IF EXISTS idx_in_app_banners_placement;
DROP INDEX IF EXISTS idx_campaign_conversions_campaign;
DROP INDEX IF EXISTS idx_campaign_variants_campaign;
DROP INDEX IF EXISTS idx_marketing_campaigns_status;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS sender_domains;
DROP TABLE IF EXISTS email_templates;
DROP TABLE IF EXISTS dlt_sms_templates;
DROP TABLE IF EXISTS push_templates;
DROP TABLE IF EXISTS in_app_banners;
DROP TABLE IF EXISTS campaign_conversions;
DROP TABLE IF EXISTS campaign_variants;
DROP TABLE IF EXISTS marketing_campaigns;
DROP TABLE IF EXISTS marketing_segments;
