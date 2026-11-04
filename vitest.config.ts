// SPDX-License-Identifier: AGPL-3.0-only
import { configDefaults, defineConfig } from 'vitest/config'

// Windows has no Unix mode bits, and its tar client treats "C:" as a remote host.
// Those files still run on Linux and macOS.
const windowsSkip = [
  'packages/storage/src/cipher.test.ts',
  'packages/storage/src/db.test.ts',
  'scripts/release-assets.test.ts',
]

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: process.platform === 'win32' ? [...configDefaults.exclude, ...windowsSkip] : configDefaults.exclude,
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
