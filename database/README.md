# Database

PostgreSQL schema, migrations, and seed data.

## Structure

- `schema/migrations`: Ordered SQL migrations (`0001_*.sql`). Each has optional paired `.down.sql` for rollback.
- `schema/migrations/*_*.down.sql`: Reverse operations (required for `migrate:down`).
- `seeds/` (future): Deterministic sample data.

## Implemented

- Core tables: organizations, competitors, competitions, competition_categories, competition_entries, timing_events
- Row Level Security enabled on all tables
- Policies for SELECT/INSERT/UPDATE/DELETE enforcing tenant isolation via GUC `app.current_org_id`
- Performance indexes (migration 0007)
- Data quality constraints & uniqueness (migration 0008)
- Application login role `ert_app` provisioning (0009) + privilege grants (0010)

## Migration Runner

Custom Node/TypeScript runner (`backend/src/migrate.ts`):

- Advisory lock to prevent concurrent execution
- SHA-256 checksums stored in `schema_migrations`
- Drift detection (`migrate:status` shows DRIFT!)
- Backfill & rebaseline commands for legacy alignment
- Safe rollback with paired down files

## Adding a Migration

1. Generate: `npm run migrate:new -- <name>` (creates up + down templates)
2. Edit SQL files
3. Apply: `npm run migrate:up`
4. Commit both files

## Policy Pattern

All policies reference `current_setting('app.current_org_id', true)`; a NULL context allows only limited admin ops (org creation). Application code sets the context per request/transaction.

## Future

- Temporal tables / audit logging
- Partitioning for timing_events (high volume)
- Seed scripts for sample competitions
- Materialized views for leaderboard aggregation
