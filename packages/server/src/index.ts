import { randomBytes } from 'node:crypto'
import { writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { holdExclusiveLock, type AppDb, type HeldLock } from '@ert/storage'
import { createApp, DEFAULT_GLOBAL_MAX, DEFAULT_RECORDING_MAX, DEFAULT_STRICT_MAX } from './app.js'
import { startBackupSchedule, writeBackup } from './backup.js'
import { assertCanListen, resolveDataDir, resolveDbPath, resolveListenPort } from './config.js'
import { openRaceDatabase } from './database.js'
import { LaunchCodes, readLaunchHandshake } from './launch-auth.js'
import { watchParent } from './parent-watch.js'
import { ensurePrivateDirectory } from './private-dir.js'
import { formatReadyLine } from './ready-line.js'

function rateMax(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

let started = false
let shuttingDown = false
let serverApp: { close: () => Promise<unknown> } | undefined
let lock: HeldLock | undefined
let stopParentWatch: (() => void) | undefined

function requestShutdown() {
  if (shuttingDown) return
  shuttingDown = true
  stopParentWatch?.()
  try {
    lock?.close()
  } catch {
    // The lock is released when the process exits either way.
  }
  const pending = serverApp ? serverApp.close() : Promise.resolve()
  pending.then(() => process.exit(0), () => process.exit(0))
}

/** Bind the local API. A second call does nothing. */
export async function startServer(): Promise<void> {
  if (started) return
  started = true
  let token: string | null
  try {
    token = await readLaunchHandshake(process.stdin)
  } catch {
    console.error('Invalid launch token')
    process.exit(1)
  }
  if (token) {
    process.stdin.on('end', () => requestShutdown())
    process.stdin.on('close', () => requestShutdown())
    stopParentWatch = watchParent(() => requestShutdown())
  }

  const host = process.env.HOST ?? '127.0.0.1'
  const dataDir = resolveDataDir(process.env, process.platform, os.homedir())
  const dbPath = resolveDbPath(process.env, dataDir)
  const requestedPort = resolveListenPort(process.env)
  const testMode = process.env.ERT_TEST_MODE === '1'
  const configuredDist = process.env.ERT_WEB_DIST?.trim()
  const webDist = configuredDist || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  const runtime = { url: '', dataDir, dbPath }

  if (token) {
    try {
      ensurePrivateDirectory(dataDir)
      lock = holdExclusiveLock(path.join(dataDir, 'server.lock'))
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }

  const db: AppDb = await openRaceDatabase(dbPath, {
    production: process.env.NODE_ENV === 'production',
    env: process.env,
  }).catch((error: unknown) => {
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
  const codes = token ? new LaunchCodes(randomBytes(32).toString('hex')) : undefined

  const { app } = await createApp({
    db,
    testMode,
    webDist,
    runtime,
    backup,
    launch: token && codes ? { token, codes } : undefined,
    rateLimit: {
      globalMax: rateMax('ERT_RATE_GLOBAL_MAX', DEFAULT_GLOBAL_MAX),
      strictMax: rateMax('ERT_RATE_STRICT_MAX', DEFAULT_STRICT_MAX),
      recordingMax: rateMax('ERT_RATE_RECORDING_MAX', DEFAULT_RECORDING_MAX),
    },
  })
  serverApp = app

  app.listen({ port: requestedPort, host }).then(() => {
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : requestedPort
    runtime.url = `http://${host}:${port}`
    // writeSync bypasses the pipe buffer so the shell sees the line immediately.
    writeSync(1, `${formatReadyLine({ url: runtime.url, dataDir, dbPath, authCode: codes?.code })}\n`)
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

const cli = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (cli === import.meta.url) {
  startServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
