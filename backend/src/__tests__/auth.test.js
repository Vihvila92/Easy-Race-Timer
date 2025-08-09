const request = require('supertest');
const { default: app } = require('../index');

describe('auth flow', () => {
  const email = `test+${Date.now()}@example.com`;
  const password = 'P@ssw0rd123';
  let orgId;

  test('signup creates user and org with token', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email, password, organization_name: 'Org One' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    orgId = res.body.data.orgId;
    expect(orgId).toBeTruthy();
  });

  test('login returns token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    // orgId can be null if no membership but here should match created
    if (orgId) expect(res.body.data.orgId).toBe(orgId);
  });
});

afterAll(async () => {
  // Attempt to close DB pool to prevent open handle warning
  try {
    const { getPool } = require('../lib/db');
    const pool = getPool();
    await pool.end();
  } catch (e) {
    // ignore
  }
});
