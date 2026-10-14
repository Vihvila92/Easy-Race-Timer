import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const devOrigin = process.env.ERT_DEV_ORIGIN ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
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
