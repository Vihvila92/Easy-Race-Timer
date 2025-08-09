module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['**/__tests__/**/*.test.(js|ts)'],
  collectCoverageFrom: ['src/**/*.{js,ts}', '!src/**/migrations/**'],
  coverageDirectory: 'coverage'
};
