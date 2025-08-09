const { Pool } = require('pg');
const { runWithOrg } = require('../lib/orgContext');

// Integration-style test; requires a real DATABASE_URL pointing to a database
// where migrations have been applied. Skips if not present or not a postgres URL.
const hasDb = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');

(hasDb ? describe : describe.skip)('org context RLS isolation', () => {
  let pool;
  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }); });
  afterAll(async () => { if (pool) await pool.end(); });

  let orgA, orgB;

  test('prepare data', async () => {
    // Create two orgs and competitors
    const { rows: orgs } = await pool.query("INSERT INTO organizations(name) VALUES ('OrgA'),('OrgB') RETURNING id ORDER BY name");
    orgA = orgs[0].id; orgB = orgs[1].id;
    await pool.query('INSERT INTO competitors(organization_id, first_name, last_name) VALUES ($1, $2, $3), ($4, $5, $6)', [orgA,'Alice','Runner', orgB,'Bob','Racer']);
  });

  test('org A sees only its competitor', async () => {
    const rows = await runWithOrg(pool, orgA, async (c) => {
      const r = await c.query('SELECT first_name FROM competitors ORDER BY first_name');
      return r.rows.map(r => r.first_name);
    });
    expect(rows).toEqual(['Alice']);
  });

  test('org B sees only its competitor', async () => {
    const rows = await runWithOrg(pool, orgB, async (c) => {
      const r = await c.query('SELECT first_name FROM competitors ORDER BY first_name');
      return r.rows.map(r => r.first_name);
    });
    expect(rows).toEqual(['Bob']);
  });
});
