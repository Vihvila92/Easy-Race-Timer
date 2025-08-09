-- 0011_auth_users
-- Users & organization membership plus basic RLS policies.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE org_users (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_users ENABLE ROW LEVEL SECURITY;

-- Users: visible only if user belongs to org context
CREATE POLICY users_select ON users
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_users ou
      WHERE ou.user_id = users.id
        AND ou.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

-- org_users: visible if org matches context.
CREATE POLICY org_users_select ON org_users
  FOR SELECT USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );

-- Insert policies
CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (current_setting('app.current_org_id', true) IS NULL);

CREATE POLICY org_users_insert ON org_users
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );

-- Update (self within org)
CREATE POLICY users_update ON users
  FOR UPDATE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_users ou WHERE ou.user_id = users.id AND ou.organization_id::text = current_setting('app.current_org_id', true)
    )
  ) WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND EXISTS (
      SELECT 1 FROM org_users ou WHERE ou.user_id = users.id AND ou.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

-- No delete policy yet (admin only future)
