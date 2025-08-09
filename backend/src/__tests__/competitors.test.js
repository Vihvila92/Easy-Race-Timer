const request = require('supertest');
const { default: app } = require('../index');

describe('competitors CRUD', () => {
  let orgId;
  let competitorId;
  const email = `crud+${Date.now()}@example.com`;
  beforeAll(async () => {
    const res = await request(app).post('/auth/signup').send({ email, password: 'StrongPass123', organization_name: 'CRUD Org' });
    if (res.status !== 201) {
      throw new Error('signup failed: ' + JSON.stringify(res.body));
    }
    orgId = res.body.data.orgId;
  });

  test('create competitor', async () => {
    const res = await request(app)
      .post('/competitors')
      .set('x-org-id', orgId)
      .send({ first_name: 'Alice', last_name: 'Runner', birth_year: 1990 });
    expect(res.status).toBe(201);
    competitorId = res.body.data.id;
  });

  test('list competitors includes created one', async () => {
    const res = await request(app)
      .get('/competitors?limit=10&offset=0')
      .set('x-org-id', orgId);
    expect(res.status).toBe(200);
    expect(res.body.data.find(c => c.id === competitorId)).toBeTruthy();
  });

  test('patch competitor', async () => {
    const res = await request(app)
      .patch(`/competitors/${competitorId}`)
      .set('x-org-id', orgId)
      .send({ last_name: 'Sprinter' });
    expect(res.status).toBe(200);
    expect(res.body.data.last_name).toBe('Sprinter');
  });

  test('delete competitor', async () => {
    const res = await request(app)
      .delete(`/competitors/${competitorId}`)
      .set('x-org-id', orgId);
    expect(res.status).toBe(204);
  });

  test('delete again 404', async () => {
    const res = await request(app)
      .delete(`/competitors/${competitorId}`)
      .set('x-org-id', orgId);
    expect(res.status).toBe(404);
  });
});

afterAll(async () => {
  try {
    const { getPool } = require('../lib/db');
    const pool = getPool();
    await pool.end();
  } catch (e) {
    // ignore
  }
});
