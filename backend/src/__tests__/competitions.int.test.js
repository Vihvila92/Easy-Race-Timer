// Integration: competitions API
const request = require('supertest');
const { default: app } = require('../index');
const { getPool } = require('../lib/db');

async function ensureOrg(orgId) {
  const pool = getPool();
  await pool.query(`INSERT INTO organizations(id, name) VALUES ($1,$2)
    ON CONFLICT (id) DO NOTHING`, [orgId, 'Test Org']);
}

describe('Competitions API', () => {
  const testOrg = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await ensureOrg(testOrg);
  });

  test('rejects missing org header', async () => {
  const res = await request(app).get('/competitions');
    expect(res.status).toBe(400);
  });

  test('create, list, detail competition', async () => {
  const createRes = await request(app)
      .post('/competitions')
      .set('x-org-id', testOrg)
      .send({ name: 'My Race', start_time: new Date().toISOString() });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe('My Race');

  const listRes = await request(app)
      .get('/competitions?limit=5&offset=0')
      .set('x-org-id', testOrg);
    expect(listRes.status).toBe(200);
    expect(listRes.body.pagination.limit).toBe(5);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.find(c => c.id === createRes.body.data.id)).toBeTruthy();

  const detail = await request(app)
      .get(`/competitions/${createRes.body.data.id}`)
      .set('x-org-id', testOrg);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(createRes.body.data.id);
  });
});
