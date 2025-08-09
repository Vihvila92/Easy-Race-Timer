const { loadConfig } = require('../config');

describe('config loader', () => {
  it('loads and validates env', () => {
    process.env.DATABASE_URL = 'https://example.com/db';
    const cfg = loadConfig();
    expect(cfg.PORT).toBeGreaterThan(0);
    expect(cfg.DATABASE_URL).toContain('example.com');
  });
});
