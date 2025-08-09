-- Down migration for 0003_rls_insert_policies
DROP POLICY IF EXISTS org_insert ON organizations;
DROP POLICY IF EXISTS competitors_insert ON competitors;
