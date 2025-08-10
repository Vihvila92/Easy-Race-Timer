// Ensure mandatory env vars for tests
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
// Only populate a real DATABASE_URL for integration tests (JEST_INT=1). For pure unit runs
// we leave it undefined so DB-dependent tests can detect absence and skip gracefully.
if (process.env.JEST_INT === '1') {
	process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://ert:ertpass@localhost:5432/ert_dev';
} else {
	delete process.env.DATABASE_URL;
}
