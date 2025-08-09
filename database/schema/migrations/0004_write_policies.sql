-- 0004_write_policies
-- Add INSERT/UPDATE/DELETE policies for writable tables.

-- Organizations: only allow update/delete when no org context (admin/system). Inserts already covered previously.
CREATE POLICY org_update ON organizations
  FOR UPDATE USING (current_setting('app.current_org_id', true) IS NULL)
  WITH CHECK (current_setting('app.current_org_id', true) IS NULL);
CREATE POLICY org_delete ON organizations
  FOR DELETE USING (current_setting('app.current_org_id', true) IS NULL);

-- Competitors: allow update/delete inside same org context.
CREATE POLICY competitors_update ON competitors
  FOR UPDATE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );
CREATE POLICY competitors_delete ON competitors
  FOR DELETE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );

-- (Future) Add write policies for competitions, categories, entries, timing_events when write paths are defined.
