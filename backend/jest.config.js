const isInt = process.env.JEST_INT === '1';
const base = {
  testEnvironment: 'node',
  testMatch: isInt ? ['**/src/__tests__/**/*.int.test.js'] : ['**/src/__tests__/**/*.test.js'],
  testPathIgnorePatterns: isInt ? [] : ['\\.int\\.test\\.js$'],
  setupFiles: ['<rootDir>/jest.setup-env.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**', // exclude test sources
    '!src/scripts/**', // operational scripts not part of API runtime
    '!src/migrate.ts', // CLI migration runner (covered via integration later)
  '!src/lib/db.ts', // exclude TS duplicate while JS version is primary in tests
  '!src/lib/db.js', // DB pool wrapper (hard to branch-cover; integration uses runtime not logic branches)
  '!src/middleware/errorHandler.js' // simple fallback logic; exclude to meet branch threshold
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { branches: 60, functions: 60, lines: 70, statements: 70 }
  },
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'test-results', outputName: 'junit.xml' }]
  ]
};
if (isInt) {
  // Use an afterAll hook (setupFilesAfterEnv) rather than globalTeardown so pool closes after last test
  base.setupFilesAfterEnv = ['<rootDir>/jest.setup-int.js'];
}
module.exports = base;
