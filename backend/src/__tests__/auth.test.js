const request = require('supertest');
const { default: app } = require('../index');

// Skip in unit mode (no DATABASE_URL) -- full flow covered in auth.int.test.js
const maybeDescribe = process.env.DATABASE_URL ? describe : describe.skip;

maybeDescribe('auth flow', () => {
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
  // decode token header.payload.signature (no verify) to assert exp claim exists
  const token = res.body.data.token;
  const payloadB64 = token.split('.')[1];
  const json = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  expect(json.exp).toBeDefined();
  expect(json.exp - json.iat).toBeLessThanOrEqual(15 * 60 + 5); // allow small clock drift margin
  });

  test('duplicate signup returns 409', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email, password, organization_name: 'Org One' });
    expect(res.status).toBe(409);
  });

  test('bad login rejected', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password: 'WrongPass123' });
    expect(res.status).toBe(401);
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

// Pool closed via globalTeardown.
