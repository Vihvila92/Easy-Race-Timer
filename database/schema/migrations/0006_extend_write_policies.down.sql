-- Down migration for 0006_extend_write_policies
-- Drops write policies added in the up migration.

DROP POLICY IF EXISTS competitions_insert ON competitions;
DROP POLICY IF EXISTS competitions_update ON competitions;
DROP POLICY IF EXISTS competitions_delete ON competitions;

DROP POLICY IF EXISTS competition_categories_insert ON competition_categories;
DROP POLICY IF EXISTS competition_categories_update ON competition_categories;
DROP POLICY IF EXISTS competition_categories_delete ON competition_categories;

DROP POLICY IF EXISTS competition_entries_insert ON competition_entries;
DROP POLICY IF EXISTS competition_entries_update ON competition_entries;
DROP POLICY IF EXISTS competition_entries_delete ON competition_entries;

DROP POLICY IF EXISTS timing_events_insert ON timing_events;
DROP POLICY IF EXISTS timing_events_update ON timing_events;
DROP POLICY IF EXISTS timing_events_delete ON timing_events;
