const request = require('supertest');
const { default: app } = require('../index');

describe('auth flow', () => {
  test('signup creates user and org with token', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'test1@example.com', password: 'P@ssw0rd123', organization_name: 'Org One' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.orgId).toBeTruthy();
  });

  test('login returns token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test1@example.com', password: 'P@ssw0rd123' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });
});
