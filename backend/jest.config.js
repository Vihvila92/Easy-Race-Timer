const isInt = process.env.JEST_INT === '1';
module.exports = {
  testEnvironment: 'node',
  testMatch: isInt ? ['**/src/__tests__/**/*.int.test.js'] : ['**/src/__tests__/**/*.test.js'],
  testPathIgnorePatterns: isInt ? [] : ['\\.int\\.test\\.js$'],
  setupFiles: ['<rootDir>/jest.setup-env.js'],
  globalTeardown: '<rootDir>/jest.global-teardown.js',
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
