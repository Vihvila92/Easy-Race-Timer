-- Down migration for 0007_indexes
DROP INDEX IF EXISTS idx_competitors_org;
DROP INDEX IF EXISTS idx_competitions_org;
DROP INDEX IF EXISTS idx_competition_categories_competition;
DROP INDEX IF EXISTS idx_competition_entries_competition_bib;
DROP INDEX IF EXISTS idx_timing_events_competition_time;
DROP INDEX IF EXISTS idx_timing_events_competition_competitor;
