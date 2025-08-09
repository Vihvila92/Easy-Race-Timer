-- 0007_indexes
-- Add performance indexes on foreign keys and query patterns.

CREATE INDEX idx_competitors_org ON competitors(organization_id);
CREATE INDEX idx_competitions_org ON competitions(organization_id);
CREATE INDEX idx_competition_categories_competition ON competition_categories(competition_id);
CREATE INDEX idx_competition_entries_competition_bib ON competition_entries(competition_id, bib_number);
CREATE INDEX idx_timing_events_competition_time ON timing_events(competition_id, event_time);
CREATE INDEX idx_timing_events_competition_competitor ON timing_events(competition_id, competitor_id);
