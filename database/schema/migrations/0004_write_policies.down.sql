-- Down migration for 0004_write_policies
DROP POLICY IF EXISTS org_update ON organizations;
DROP POLICY IF EXISTS org_delete ON organizations;
DROP POLICY IF EXISTS competitors_update ON competitors;
DROP POLICY IF EXISTS competitors_delete ON competitors;
