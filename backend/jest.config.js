const isInt = process.env.JEST_INT === '1';
const base = {
  testEnvironment: 'node',
  testMatch: isInt ? ['**/src/__tests__/**/*.int.test.js'] : ['**/src/__tests__/**/*.test.js'],
  testPathIgnorePatterns: isInt ? [] : ['\\.int\\.test\\.js$'],
  setupFiles: ['<rootDir>/jest.setup-env.js'],
  collectCoverageFrom: ['src/**/*.{ts,js}', '!src/**/*.d.ts'],
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
