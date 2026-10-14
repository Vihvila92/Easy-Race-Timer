import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupDatabase, openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { resolveDataDir, resolveDbPath, resolveListenPort } from './config.js'

const host = process.env.HOST ?? '127.0.0.1'
const dbPath = resolveDbPath(process.env, resolveDataDir(process.env, process.platform, os.homedir()))
const dataDir = path.dirname(dbPath)
const requestedPort = resolveListenPort(process.env)
const testMode = process.env.ERT_TEST_MODE === '1'
const webDist = process.env.ERT_WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const runtime = { url: '', dataDir, dbPath }

const db = openDatabase(dbPath)
const { app } = createApp({ db, testMode, webDist, runtime })

const backupTimer = setInterval(() => {
  const dest = path.join(dataDir, 'backups', `ert-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
  try { backupDatabase(db, dest) } catch { /* a memory database has nothing to copy */ }
}, 5 * 60 * 1000)
backupTimer.unref()

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
