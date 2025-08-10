// Integration: auth flow
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

  test('login returns token with exp claim', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    if (orgId) expect(res.body.data.orgId).toBe(orgId);
    const token = res.body.data.token;
    const payloadB64 = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    expect(json.exp).toBeDefined();
    expect(json.exp - json.iat).toBeLessThanOrEqual(15 * 60 + 5);
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
