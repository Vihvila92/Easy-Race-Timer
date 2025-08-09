\connect ert_dev
-- Force row level security for all future tables (Postgres doesn't have a global toggle, set per table post creation)
-- We'll rely on ENABLE ROW LEVEL SECURITY in migrations.
