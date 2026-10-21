// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolveSourceRef, sourceCodeUrl } from './src/source-link.ts'

const root = path.dirname(fileURLToPath(import.meta.url))
const devOrigin = process.env.ERT_DEV_ORIGIN ?? 'http://127.0.0.1:8080'

function gitOutput(args: string[]): string | null {
  try {
    const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return output || null
  } catch {
    return null
  }
}

const sourceRef = resolveSourceRef({
  envRef: process.env.ERT_SOURCE_REF,
  exactTag: gitOutput(['describe', '--tags', '--exact-match']),
  commit: gitOutput(['rev-parse', 'HEAD']) ?? process.env.GITHUB_SHA,
})
sourceCodeUrl(sourceRef)
const appVersion = JSON.parse(readFileSync(path.resolve(root, '../../package.json'), 'utf8')).version as string

export default defineConfig({
  plugins: [react()],
  define: {
    __ERT_SOURCE_REF__: JSON.stringify(sourceRef),
    __ERT_VERSION__: JSON.stringify(appVersion),
  },
  build: { target: 'es2019' },
  resolve: {
    alias: {
      '@ert/i18n': path.resolve(root, '../i18n/src/index.ts'),
      '@ert/sports': path.resolve(root, '../sports/src/index.ts'),
      '@ert/core': path.resolve(root, '../core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // Developer proxy only. It is not part of the built app. The built UI uses same-origin /api and /ws.
    proxy: {
      '/api': devOrigin,
      '/ws': { target: devOrigin.replace(/^http/, 'ws'), ws: true },
    },
  },
})
