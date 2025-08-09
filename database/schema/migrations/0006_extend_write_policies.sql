-- 0006_extend_write_policies
-- Add write (INSERT/UPDATE/DELETE) policies for remaining tables: competitions, competition_categories, competition_entries, timing_events.

-- Competitions: allow CRUD inside org context.
CREATE POLICY competitions_insert ON competitions
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );
CREATE POLICY competitions_update ON competitions
  FOR UPDATE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  ) WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );
CREATE POLICY competitions_delete ON competitions
  FOR DELETE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND organization_id::text = current_setting('app.current_org_id', true)
  );

-- Competition categories: org inferred through competition.
CREATE POLICY competition_categories_insert ON competition_categories
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
CREATE POLICY competition_categories_update ON competition_categories
  FOR UPDATE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  ) WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
CREATE POLICY competition_categories_delete ON competition_categories
  FOR DELETE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

-- Competition entries: competitor and competition must belong to org.
CREATE POLICY competition_entries_insert ON competition_entries
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    ) AND competitor_id IN (
      SELECT comp.id FROM competitors comp WHERE comp.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
CREATE POLICY competition_entries_update ON competition_entries
  FOR UPDATE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  ) WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
CREATE POLICY competition_entries_delete ON competition_entries
  FOR DELETE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );

-- Timing events: only within competitions of the org.
CREATE POLICY timing_events_insert ON timing_events
  FOR INSERT WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
CREATE POLICY timing_events_update ON timing_events
  FOR UPDATE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  ) WITH CHECK (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
CREATE POLICY timing_events_delete ON timing_events
  FOR DELETE USING (
    current_setting('app.current_org_id', true) IS NOT NULL AND competition_id IN (
      SELECT c.id FROM competitions c WHERE c.organization_id::text = current_setting('app.current_org_id', true)
    )
  );
