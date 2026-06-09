-- Infra hardening: the Helm/production deployment connects to Postgres as a
-- least-privilege application role (app_gateway, see deploy/production-values.yaml),
-- but no migration ever provisioned it, so production DB authentication failed.
-- Create the role with DML-only privileges on the application schema.
--
-- NOTE: this password MUST match the credential injected via the k8s
-- *-db-credentials secret. Treat it as a bootstrap default and rotate both
-- together through your secret manager; it is not production-safe as committed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_gateway') THEN
    CREATE ROLE app_gateway WITH LOGIN PASSWORD 'HardenedProdPassword';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE delivery_platform TO app_gateway;
GRANT USAGE ON SCHEMA public TO app_gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_gateway;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_gateway;

-- Apply the same grants automatically to tables/sequences created by later
-- migrations (which run as the migration owner, typically postgres).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_gateway;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_gateway;
