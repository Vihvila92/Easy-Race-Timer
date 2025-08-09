const request = require('supertest');
const { start } = require('../index');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');

let server;

beforeAll(async () => {
  server = start();
});

afterAll(async () => {
  if (server) server.close();
  const pool = getPool();
  await pool.end();
});

// Helper to ensure an org exists + context (seed may have created, but create if missing)
async function ensureOrg(orgId) {
  const pool = getPool();
  await pool.query(`INSERT INTO organizations(id, name) VALUES ($1,$2)
    ON CONFLICT (id) DO NOTHING`, [orgId, 'Test Org']);
}

const hasDb = !!process.env.DATABASE_URL;
const maybeDescribe = hasDb ? describe : describe.skip;

maybeDescribe('Competitions API', () => {
  const testOrg = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await ensureOrg(testOrg);
  });

  test('rejects missing org header', async () => {
    const res = await request(server).get('/competitions');
    expect(res.status).toBe(400);
  });

  test('create and list competition', async () => {
    const createRes = await request(server)
      .post('/competitions')
      .set('x-org-id', testOrg)
  .send({ name: 'My Race', start_time: new Date().toISOString() });
    expect(createRes.status).toBe(201);
  expect(createRes.body.data.name).toBe('My Race');

    const listRes = await request(server)
      .get('/competitions')
      .set('x-org-id', testOrg);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.find(c => c.id === createRes.body.data.id)).toBeTruthy();
  });
});
