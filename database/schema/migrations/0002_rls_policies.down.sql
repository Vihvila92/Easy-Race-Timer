-- Down migration for 0002_rls_policies
DROP POLICY IF EXISTS org_select ON organizations;
DROP POLICY IF EXISTS competitors_select ON competitors;
DROP POLICY IF EXISTS competitions_select ON competitions;
DROP POLICY IF EXISTS competition_categories_select ON competition_categories;
DROP POLICY IF EXISTS competition_entries_select ON competition_entries;
DROP POLICY IF EXISTS timing_events_select ON timing_events;
DROP FUNCTION IF EXISTS set_current_org(UUID);
