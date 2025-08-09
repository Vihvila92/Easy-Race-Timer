-- Down migration for 0008_constraints
ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_bib_positive;
DROP INDEX IF EXISTS competition_entries_unique_bib;
DROP INDEX IF EXISTS uniq_competitor_identity;
ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_birth_year_range;
