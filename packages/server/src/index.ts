// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import { writeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { holdExclusiveLock, openDatabase, type AppDb, type HeldLock } from '@ert/storage'
import { createApp, DEFAULT_GLOBAL_MAX, DEFAULT_RECORDING_MAX, DEFAULT_STRICT_MAX } from './app.js'
import { startBackupSchedule, writeBackup } from './backup.js'
import { assertCanListen, resolveDataDir, resolveDbPath, resolveListenPort } from './config.js'
import { databaseProxy, envelopeReady, type DatabaseSlot } from './database-slot.js'
import { openRaceDatabase } from './database.js'
import { LaunchCodes, readLaunchHandshake } from './launch-auth.js'
import { watchParent } from './parent-watch.js'
import { ensurePrivateDirectory } from './private-dir.js'
import { formatRaceFileError } from './race-file.js'
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

function exitWith(error: unknown): never {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

async function readLaunchToken(): Promise<string | null> {
  try {
    return await readLaunchHandshake(process.stdin)
  } catch {
    console.error('Invalid launch token')
    process.exit(1)
  }
}

function armShutdown(token: string | null): void {
  if (!token) return
  process.stdin.on('end', () => requestShutdown())
  process.stdin.on('close', () => requestShutdown())
  stopParentWatch = watchParent(() => requestShutdown())
}

function lockDataDir(token: string | null, dataDir: string): void {
  if (!token) return
  try {
    ensurePrivateDirectory(dataDir)
    lock = holdExclusiveLock(path.join(dataDir, 'server.lock'))
  } catch (error) {
    exitWith(error)
  }
}

async function openInitial(dbPath: string, token: string | null): Promise<AppDb> {
  try {
    return await openRaceDatabase(dbPath, {
      production: process.env.NODE_ENV === 'production',
      desktop: Boolean(token),
      env: process.env,
    })
  } catch (error) {
    if (!envelopeReady(dbPath)) {
      console.error(formatRaceFileError(error))
      process.exit(1)
    }
    return openDatabase(':memory:')
  }
}

function assertListen(host: string, db: AppDb): void {
  const pinConfigured = db.filePath !== ':memory:' && Boolean(db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM event WHERE pin_hash IS NOT NULL LIMIT 1')?.pin_hash)
  try {
    assertCanListen(host, pinConfigured)
  } catch (error) {
    exitWith(error)
  }
}

function scheduleBackup(slot: DatabaseSlot, backupDir: string): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  const start = () => {
    if (timer || slot.current.filePath === ':memory:') return
    timer = startBackupSchedule(databaseProxy(slot), backupDir)
  }
  start()
  return start
}

function webDistPath(): string {
  const configured = process.env.ERT_WEB_DIST?.trim()
  if (configured) return configured
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
}

function listen(input: {
  app: { listen: (opts: { port: number; host: string }) => Promise<unknown>; server: { address: () => unknown } }
  host: string
  requestedPort: number
  runtime: { url: string; dataDir: string; dbPath: string }
  code: string | undefined
}): void {
  input.app.listen({ port: input.requestedPort, host: input.host }).then(() => {
    const address = input.app.server.address()
    const port = typeof address === 'object' && address ? (address as { port: number }).port : input.requestedPort
    input.runtime.url = `http://${input.host}:${port}`
    writeSync(1, `${formatReadyLine({ url: input.runtime.url, dataDir: input.runtime.dataDir, dbPath: input.runtime.dbPath, authCode: input.code })}\n`)
  }).catch((error: unknown) => exitWith(error))
}

/** Bind the local API. A second call does nothing. */
export async function startServer(): Promise<void> {
  if (started) return
  started = true
  const token = await readLaunchToken()
  armShutdown(token)
  const host = process.env.HOST ?? '127.0.0.1'
  const dataDir = resolveDataDir(process.env, process.platform, os.homedir())
  const dbPath = resolveDbPath(process.env, dataDir)
  lockDataDir(token, dataDir)
  const slot: DatabaseSlot = { current: await openInitial(dbPath, token) }
  assertListen(host, slot.current)
  const backupDir = path.join(dataDir, 'backups')
  const startBackup = scheduleBackup(slot, backupDir)
  const codes = token ? new LaunchCodes(randomBytes(32).toString('hex')) : undefined
  const runtime = { url: '', dataDir, dbPath }
  const { app } = await createApp({
    db: slot.current,
    slot,
    testMode: process.env.ERT_TEST_MODE === '1',
    webDist: webDistPath(),
    runtime,
    backup: (reason) => slot.current.filePath === ':memory:' ? Promise.resolve() : writeBackup(slot.current, backupDir, reason),
    onOpen: () => startBackup(),
    launch: token && codes ? { token, codes } : undefined,
    rateLimit: {
      globalMax: rateMax('ERT_RATE_GLOBAL_MAX', DEFAULT_GLOBAL_MAX),
      strictMax: rateMax('ERT_RATE_STRICT_MAX', DEFAULT_STRICT_MAX),
      recordingMax: rateMax('ERT_RATE_RECORDING_MAX', DEFAULT_RECORDING_MAX),
    },
  })
  serverApp = app
  listen({ app, host, requestedPort: resolveListenPort(process.env), runtime, code: codes?.code })
}

const cli = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (cli === import.meta.url) {
  startServer().catch((error: unknown) => exitWith(error))
}
