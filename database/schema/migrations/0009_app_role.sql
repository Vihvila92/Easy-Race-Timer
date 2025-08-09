-- 0009_app_role
-- Ensure application least-privilege login role exists (also used by CI integration tests)

DO $$
DECLARE
  dbname text := current_database();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ert_app') THEN
    EXECUTE 'CREATE ROLE ert_app LOGIN PASSWORD ''ert_apppass'' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ert_app', dbname);
END$$ LANGUAGE plpgsql;

GRANT USAGE ON SCHEMA public TO ert_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ert_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ert_app;
