# Backend

Minimal Express backend scaffold with migrations, multi-tenant RLS (read + write isolation), and test utilities.

Added features: custom migration runner (checksums + drift), structured logging, competitions & entries APIs, org header middleware, RLS integration tests, Dependabot & CodeQL.

## Local Development Database

Requires Docker. A Postgres 15 instance is defined in `deployment/docker-compose.dev.yml`.

Start database:

```bash
npm run db:up
```

Add to `.env` (or export) for local dev:

```env
DATABASE_URL=postgres://ert:ertpass@localhost:5432/ert_dev
```

Run migrations:

```bash
npm run migrate:up
```

Status:

```bash
npm run migrate:status
```

Run integration RLS test (DB must be up & migrated):

```bash
npm run test:int
```

Tear down database:

```bash
npm run db:down
```

## Org Context Helper

Use `runWithOrg(pool, orgId, fn)` from `src/lib/orgContext.js` to execute queries under a tenant context enforced by RLS.

Example:

```js
const { runWithOrg } = require('./lib/orgContext');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
runWithOrg(pool, orgId, async (client) => {
	const { rows } = await client.query('SELECT * FROM competitors');
	return rows;
});
```

## Scripts

| Script | Purpose |
| ------ | ------- |
| dev | Run dev server (ts-node-dev) |
| build | TypeScript compile |
| start | Run built server |
| migrate:up | Apply pending migrations (auto backfills missing checksums) |
| migrate:down | Roll back latest migration(s) (requires corresponding .down.sql files) |
| migrate:status | Show migration status & drift indicators |
| migrate:backfill | Backfill checksums for legacy applied migrations |
| migrate:rebaseline | Accept current files as new checksum baseline (clears drift) |
| migrate:new -- <name\> | Generate a new sequential migration SQL template |
| migrate:check | Exit non-zero if pending / drift / missing checksums (for CI) |
| db:up | Start local Postgres |
| db:down | Stop local Postgres |
| test | Unit tests (integration RLS skipped) |
| test:int | RLS integration test (requires DB, uses app role) |
| seed | Populate database with sample data (orgs, competitions, competitors, entries, events) |


## RLS Overview

Row Level Security uses a custom GUC `app.current_org_id` set per session. `runWithOrg` enables context; outside a context only limited admin operations (e.g. seeding organizations) are allowed. Policies cover SELECT/INSERT/UPDATE/DELETE for: organizations (read; write only when no context), competitors, competitions, competition_categories, competition_entries, timing_events.

## Migration Integrity

Each migration's SHA-256 checksum is stored. `migrate:status` flags drift, `migrate:rebaseline` updates stored checksums after intentional edits. An advisory lock prevents concurrent runners. `migrate:check` is CI-friendly: fails build on pending/drift/missing checksums. Unsafe commands (`down`, `rebaseline`) are blocked when `MIGRATION_ENV=production` unless `MIGRATION_FORCE=1`.

## DB Session Hardening

Pool enforces fixed `search_path=public` plus timeouts:

- `statement_timeout` (env: `DB_STATEMENT_TIMEOUT_MS`, default 5000)
- `idle_in_transaction_session_timeout` (env: `DB_IDLE_TXN_TIMEOUT_MS`, default 10000)
- `lock_timeout` (env: `DB_LOCK_TIMEOUT_MS`, default 5000)

Also sets `application_name` (env: `DB_APPLICATION_NAME`).

## TODO (future)

- Auth (JWT) & user/role management
- WebSocket realtime timing events
- Metrics / tracing (OpenTelemetry) & latency SLOs
- Rate limiting & error code documentation
- Additional endpoints (competitors CRUD, competitions detail, timing events ingestion)
- Seed script expansion & deterministic sample data
- Pagination metadata total counts (currently only page size & count returned)
- API versioning strategy documentation
