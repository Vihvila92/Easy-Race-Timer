import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupDatabase, openDatabase } from '@ert/storage'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? '127.0.0.1'
const dbPath = process.env.ERT_DB ?? path.join(process.cwd(), 'data', 'ert.sqlite')
const testMode = process.env.ERT_TEST_MODE === '1'
const webDist = process.env.ERT_WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')

const db = openDatabase(dbPath)
const { app } = createApp({ db, testMode, webDist })

const backupTimer = setInterval(() => {
  const dest = path.join(path.dirname(dbPath), 'backups', `ert-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
  try { backupDatabase(db, dest) } catch { /* a memory database has nothing to copy */ }
}, 5 * 60 * 1000)
backupTimer.unref()

app.listen({ port, host }).then(() => {
  app.log.info?.(`Easy Race Timer listening on http://${host}:${port}`)
  console.log(`Easy Race Timer listening on http://${host}:${port}`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
