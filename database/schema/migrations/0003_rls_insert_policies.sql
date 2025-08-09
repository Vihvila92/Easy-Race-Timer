-- 0003_rls_insert_policies
-- Add INSERT policies required for tests and app writes.

-- Allow inserting organizations only when no org context (system provisioning) OR explicitly self-owned (not typical at creation time).
CREATE POLICY org_insert ON organizations
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
  );

-- Allow inserting competitors when org context matches target organization_id.
CREATE POLICY competitors_insert ON competitors
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );
