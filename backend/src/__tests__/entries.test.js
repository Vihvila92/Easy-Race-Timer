const request = require('supertest');
const appModule = require('../index');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');

const app = appModule.default;
const hasDb = !!process.env.DATABASE_URL; // Only present in integration mode
const maybeDescribe = hasDb ? describe : describe.skip;

// Helper to seed org + competitor + competition
async function seedOrgData(orgId) {
  const pool = getPool();
  await pool.query('INSERT INTO organizations(id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [orgId, 'SeedOrg']);
  const compRes = await runWithOrg(pool, orgId, async (c) => {
    const r1 = await c.query('INSERT INTO competitors(organization_id, first_name, last_name) VALUES ($1,$2,$3) RETURNING id',[orgId,'Test','Runner']);
    const r2 = await c.query('INSERT INTO competitions(organization_id, name) VALUES ($1,$2) RETURNING id',[orgId,'SeedComp']);
    return { competitorId: r1.rows[0].id, competitionId: r2.rows[0].id };
  });
  return compRes;
}

maybeDescribe('entries API', () => {
  const orgId = '00000000-0000-0000-0000-0000000000aa';
  let competitionId; let competitorId;

  beforeAll(async () => {
    const seeded = await seedOrgData(orgId);
    competitionId = seeded.competitionId; competitorId = seeded.competitorId;
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.end();
  });

  test('create entry', async () => {
    const res = await request(app)
      .post('/entries')
      .set('x-org-id', orgId)
      .send({ competition_id: competitionId, competitor_id: competitorId, bib_number: 12 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ competition_id: competitionId, competitor_id: competitorId, bib_number: 12 });
  });

  test('duplicate entry rejected with 409', async () => {
    const res = await request(app)
      .post('/entries')
      .set('x-org-id', orgId)
      .send({ competition_id: competitionId, competitor_id: competitorId, bib_number: 12 });
    expect(res.status).toBe(409);
  });

  test('list entries with pagination', async () => {
    const res = await request(app)
      .get(`/competitions/${competitionId}/entries?limit=10&offset=0`)
      .set('x-org-id', orgId);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ limit: 10, offset: 0 });
  });

  test('404 for unknown competition', async () => {
    const res = await request(app)
      .get(`/competitions/00000000-0000-0000-0000-00000000ffff/entries`)
      .set('x-org-id', orgId);
    expect(res.status).toBe(404);
  });
});
