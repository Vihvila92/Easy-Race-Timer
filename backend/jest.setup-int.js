// Integration test specific afterAll teardown.
// Ensures pg pool is closed once all integration suites finish so Jest can exit cleanly.
const { closePool } = require('./src/lib/db');

afterAll(async () => {
  await closePool();
});
