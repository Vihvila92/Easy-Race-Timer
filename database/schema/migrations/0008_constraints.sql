-- 0008_constraints
-- Add data quality constraints and uniqueness rules.

-- Positive bib numbers (if provided) and uniqueness within competition.
ALTER TABLE competition_entries
  ADD CONSTRAINT competition_entries_bib_positive CHECK (bib_number IS NULL OR bib_number > 0);

-- Conditional uniqueness needs a partial unique index (cannot use WHERE on a table constraint)
CREATE UNIQUE INDEX competition_entries_unique_bib ON competition_entries(competition_id, bib_number)
  WHERE bib_number IS NOT NULL;

-- Competitor identity uniqueness within an organization (case-insensitive names).
CREATE UNIQUE INDEX uniq_competitor_identity ON competitors(organization_id, lower(first_name), lower(last_name), birth_year);

-- Reasonable birth year range (allow null, else >=1900 and <= current year).
ALTER TABLE competitors
  ADD CONSTRAINT competitors_birth_year_range CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND EXTRACT(YEAR FROM now())::INT));
