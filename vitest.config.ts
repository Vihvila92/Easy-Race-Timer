// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      ERT_DEV_KEY: '1',
      SQLITE_USE_URI: '1',
    },
  },
})
