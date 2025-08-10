// Ensure mandatory env vars for tests
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://ert:ertpass@localhost:5432/ert_dev';
