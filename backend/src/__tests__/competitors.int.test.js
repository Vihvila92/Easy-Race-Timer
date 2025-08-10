// Integration: competitors CRUD
const request = require('supertest');
const { default: app } = require('../index');
// Pool closed via global teardown

describe('competitors CRUD', () => {
  let orgId; let competitorId;
  const email = `crud+${Date.now()}@example.com`;
  beforeAll(async () => {
    const res = await request(app).post('/auth/signup').send({ email, password: 'StrongPass123', organization_name: 'CRUD Org' });
    if (res.status !== 201) throw new Error('signup failed: ' + JSON.stringify(res.body));
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

  test('list + detail includes competitor', async () => {
    const res = await request(app)
      .get('/competitors?limit=10&offset=0')
      .set('x-org-id', orgId);
    expect(res.status).toBe(200);
    expect(res.body.data.find(c => c.id === competitorId)).toBeTruthy();
    const detail = await request(app)
      .get(`/competitors/${competitorId}`)
      .set('x-org-id', orgId);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(competitorId);
  });

  test('validation error on missing last_name', async () => {
    const bad = await request(app)
      .post('/competitors')
      .set('x-org-id', orgId)
      .send({ first_name: 'OnlyFirst' });
    expect(bad.status).toBe(422);
  });

  test('missing org header rejected', async () => {
    const res = await request(app).get('/competitors');
    expect(res.status).toBe(400);
  });

  test('patch competitor', async () => {
    const res = await request(app)
      .patch(`/competitors/${competitorId}`)
      .set('x-org-id', orgId)
      .send({ last_name: 'Sprinter' });
    expect(res.status).toBe(200);
    expect(res.body.data.last_name).toBe('Sprinter');
  });

  test('delete competitor + 404 second delete', async () => {
    const res = await request(app)
      .delete(`/competitors/${competitorId}`)
      .set('x-org-id', orgId);
    expect(res.status).toBe(204);
    const again = await request(app)
      .delete(`/competitors/${competitorId}`)
      .set('x-org-id', orgId);
    expect(again.status).toBe(404);
  });

});
