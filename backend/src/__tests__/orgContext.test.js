const { Pool } = require('pg');
const { runWithOrg } = require('../lib/orgContext');

// Integration-style test; requires a real DATABASE_URL pointing to a database
// where migrations have been applied. Skips if not present or not a postgres URL.
const hasDb = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');

(hasDb && process.env.APP_ROLE === '1' ? describe : describe.skip)('org context RLS isolation', () => {
  let pool;
  beforeAll(() => {
    // Use app role if available for RLS enforcement
    const base = new URL(process.env.DATABASE_URL);
    if (process.env.APP_ROLE === '1') {
      base.username = 'ert_app';
      base.password = 'ert_apppass';
    }
    pool = new Pool({ connectionString: base.toString() });
  });
  afterAll(async () => { if (pool) await pool.end(); });

  let orgA, orgB;

  test('prepare data', async () => {
    // Clean any previous residue (idempotent for re-runs)
    await pool.query("DELETE FROM competitors");
    await pool.query("DELETE FROM organizations");
    // Insert and deterministically order via CTE
    // Organizations insertion must bypass org context; allowed when context NULL
  const orgInsert = await pool.query("WITH ins AS (INSERT INTO organizations(name) VALUES ('OrgA'),('OrgB') RETURNING id, name) SELECT id, name FROM ins ORDER BY name");
    expect(orgInsert.rowCount).toBe(2);
    orgA = orgInsert.rows[0].id; orgB = orgInsert.rows[1].id;
    // Insert each competitor within its org context to satisfy INSERT policy
    await runWithOrg(pool, orgA, async (c) => {
      const r = await c.query('INSERT INTO competitors(organization_id, first_name, last_name) VALUES ($1,$2,$3) RETURNING id',[orgA,'Alice','Runner']);
      expect(r.rowCount).toBe(1);
    });
    await runWithOrg(pool, orgB, async (c) => {
      const r = await c.query('INSERT INTO competitors(organization_id, first_name, last_name) VALUES ($1,$2,$3) RETURNING id',[orgB,'Bob','Racer']);
      expect(r.rowCount).toBe(1);
    });
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
