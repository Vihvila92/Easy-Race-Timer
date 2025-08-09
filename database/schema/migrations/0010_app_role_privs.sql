-- 0010_app_role_privs
-- Grant required DML privileges on existing tables/sequences to ert_app (RLS still applies)
-- Idempotent grants; safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ert_app') THEN
    RAISE NOTICE 'Role ert_app does not exist (nothing to grant)';
    RETURN;
  END IF;
END$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ert_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ert_app;
