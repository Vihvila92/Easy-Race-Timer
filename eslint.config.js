// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { leanRules } from './scripts/lean-limits.js'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'testdata/**',
      '**/*.cjs',
      'packages/web/public/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // Warnings on the whole tree. scripts/check-complexity.ts reruns these
      // as errors for files added or changed against the base branch.
      ...leanRules('warn'),
    },
  },
)
