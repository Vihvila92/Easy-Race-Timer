module.exports = {
  root: true,
  env: { node: true, es2022: true, jest: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/strict',
    'plugin:@typescript-eslint/stylistic',
    'prettier'
  ],
  rules: {
    'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-var-requires': 'off'
  },
  overrides: [
    {
      files: ['src/migrate.ts', 'src/lib/db.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/ban-ts-comment': 'off'
      }
    },
    {
      files: ['src/**/*.test.js', 'src/**/*.int.test.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      files: ['src/lib/orgContext.js'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['off']
      }
    }
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'src/lib/db.js',
    '.eslintrc.cjs',
    'jest.config.js',
    'jest.config.cjs',
    'jest.*.js' // ignore Jest env/setup/teardown helper scripts
  ]
};
