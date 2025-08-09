const request = require('supertest');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'https://example.com/db';
const app = require('../index.js').default;

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
