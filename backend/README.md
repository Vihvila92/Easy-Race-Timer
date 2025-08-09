# Backend

Minimal Express backend scaffold with migrations, multi-tenant RLS, and test utilities.

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
| migrate:up | Apply pending migrations |
| migrate:status | Show migration status |
| db:up | Start local Postgres |
| db:down | Stop local Postgres |
| test | Unit tests |
| test:int | RLS integration test (requires DB) |


## TODO (next hardening)

- Advisory lock & checksums for migrations
- Rollback support
- Seed script
- Expanded API routes
