import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

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
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
})
