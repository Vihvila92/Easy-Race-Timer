import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDb } from '@ert/storage'
import { createApp, DEFAULT_GLOBAL_MAX, DEFAULT_RECORDING_MAX, DEFAULT_STRICT_MAX } from './app.js'
import { startBackupSchedule, writeBackup } from './backup.js'
import { assertCanListen, resolveDataDir, resolveDbPath, resolveListenPort } from './config.js'

function rateMax(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

const host = process.env.HOST ?? '127.0.0.1'
const dbPath = resolveDbPath(process.env, resolveDataDir(process.env, process.platform, os.homedir()))
const dataDir = path.dirname(dbPath)
const requestedPort = resolveListenPort(process.env)
const testMode = process.env.ERT_TEST_MODE === '1'
const webDist = process.env.ERT_WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const runtime = { url: '', dataDir, dbPath }

const db: AppDb = await openDatabase(dbPath).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

const pinConfigured = Boolean(db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM event WHERE pin_hash IS NOT NULL LIMIT 1')?.pin_hash)
try {
  assertCanListen(host, pinConfigured)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const backupDir = path.join(dataDir, 'backups')
const backup = (reason: string) => writeBackup(db, backupDir, reason)
startBackupSchedule(db, backupDir)

const { app } = await createApp({
  db,
  testMode,
  webDist,
  runtime,
  backup,
  rateLimit: {
    globalMax: rateMax('ERT_RATE_GLOBAL_MAX', DEFAULT_GLOBAL_MAX),
    strictMax: rateMax('ERT_RATE_STRICT_MAX', DEFAULT_STRICT_MAX),
    recordingMax: rateMax('ERT_RATE_RECORDING_MAX', DEFAULT_RECORDING_MAX),
  },
})

app.listen({ port: requestedPort, host }).then(() => {
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : requestedPort
  runtime.url = `http://${host}:${port}`
  const ready = { url: runtime.url, dataDir, dbPath }
  console.log(`ERT_READY ${JSON.stringify(ready)}`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
