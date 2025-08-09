-- 0002_rls_policies
-- Multi-tenant Row Level Security policies.
-- Uses a custom GUC (custom parameter) app.current_org_id set per session/transaction.
-- Middleware / DB layer must execute: SELECT set_config('app.current_org_id', $1, false);

-- Helper function to set org id inside DB (optional usage through SELECT set_current_org(<uuid>))
CREATE OR REPLACE FUNCTION set_current_org(org_uuid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_org_id', org_uuid::text, false);
END;$$;

-- Safety: ensure extension for gen_random_uuid already requested in prior migration.

-- Organizations table: allow all rows only if no org context (admin scenario) else restrict to own id.
CREATE POLICY org_select ON organizations
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NULL
    OR id::text = current_setting('app.current_org_id', true)
  );

-- Generic tenant match expression reused across tables referencing organization_id.
-- We embed logic directly; could use a SECURITY DEFINER function if complexity grows.

CREATE POLICY competitors_select ON competitors
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );

CREATE POLICY competitions_select ON competitions
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );

CREATE POLICY competition_categories_select ON competition_categories
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

CREATE POLICY competition_entries_select ON competition_entries
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

CREATE POLICY timing_events_select ON timing_events
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

-- Future: INSERT/UPDATE/DELETE policies once write APIs are added.
