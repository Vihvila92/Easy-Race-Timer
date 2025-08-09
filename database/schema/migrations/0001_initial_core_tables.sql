-- 0001_initial_core_tables
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_year INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE competition_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_age INT,
  max_age INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE competition_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  bib_number INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(competition_id, competitor_id)
);

CREATE TABLE timing_events (
  id BIGSERIAL PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  competitor_id UUID REFERENCES competitors(id) ON DELETE SET NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT, -- manual, device, import
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable pgcrypto for gen_random_uuid if not already
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Basic multi-tenancy isolation via RLS placeholder (policies added later)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timing_events ENABLE ROW LEVEL SECURITY;
