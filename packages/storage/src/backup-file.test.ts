// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { backupDatabase, recoverRestore, restoreBackupPair, restoreHooks } from './backup-file.js'
import { BACKUP_KEEP_RECENT, pruneBackups } from './backup-prune.js'
import { openDatabase } from './db.js'
import { keyFilePath, writeKeyStub } from './key-file.js'

const FILE_ID = '0123456789abcdef0123456789abcdef'
const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-restore-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  restoreHooks.crashAt = undefined
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function preparedPair() {
  const dir = tempDir()
  const db = await openDatabase(path.join(dir, 'ert.sqlite'))
  db.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
    VALUES ('EV', 'local', 'Kept', '2027-06-12', 'Europe/Helsinki', 'run', '{}', 1, 1, '1')`)
  const backup = path.join(dir, 'copy.sqlite')
  await backupDatabase(db, backup)
  const backupBytes = fs.readFileSync(backup)
  const backupKey = fs.readFileSync(keyFilePath(backup))
  db.raw.close()
  const restored = path.join(dir, 'restored.sqlite')
  fs.writeFileSync(restored, 'old-db')
  fs.writeFileSync(keyFilePath(restored), 'old-key')
  fs.writeFileSync(`${restored}-wal`, 'old-wal')
  fs.writeFileSync(`${restored}-shm`, 'old-shm')
  return { dir, backup, restored, backupBytes, backupKey }
}

async function crashAt(step: NonNullable<typeof restoreHooks.crashAt>) {
  const ready = await preparedPair()
  restoreHooks.crashAt = step
  await expect(restoreBackupPair(ready.backup, ready.restored, () => {})).rejects.toThrow(`crash at ${step}`)
  restoreHooks.crashAt = undefined
  return ready
}

it('drops a prepared copy when the crash is before the previous pair moves', async () => {
  const { restored } = await crashAt('prepared')
  expect(fs.readFileSync(restored, 'utf8')).toBe('old-db')
  expect(fs.readFileSync(`${restored}-wal`, 'utf8')).toBe('old-wal')
  recoverRestore(restored)
  expect(fs.readFileSync(restored, 'utf8')).toBe('old-db')
  expect(fs.readFileSync(keyFilePath(restored), 'utf8')).toBe('old-key')
  expect(fs.readdirSync(path.dirname(restored)).some((name) => name.includes('.restore'))).toBe(false)
})

it('keeps the old journal until the new pair is in place', async () => {
  const { restored, backupBytes, backupKey } = await crashAt('prev')
  expect(fs.existsSync(restored)).toBe(false)
  expect(fs.existsSync(`${restored}-wal`)).toBe(false)
  expect(fs.readFileSync(`${restored}.prev`, 'utf8')).toBe('old-db')
  expect(fs.readFileSync(`${restored}-wal.prev`, 'utf8')).toBe('old-wal')
  recoverRestore(restored)
  expect(fs.readFileSync(restored).equals(backupBytes)).toBe(true)
  expect(fs.readFileSync(keyFilePath(restored)).equals(backupKey)).toBe(true)
  expect(fs.existsSync(`${restored}.prev`)).toBe(false)
  expect(fs.existsSync(`${restored}-wal.prev`)).toBe(false)
})

it('finishes a crash between the database rename and the key rename', async () => {
  const { restored, backupBytes, backupKey } = await crashAt('database')
  expect(fs.readFileSync(restored).equals(backupBytes)).toBe(true)
  expect(fs.existsSync(keyFilePath(restored))).toBe(false)
  expect(fs.readFileSync(`${keyFilePath(restored)}.prev`).equals(Buffer.from('old-key'))).toBe(true)
  recoverRestore(restored)
  expect(fs.readFileSync(keyFilePath(restored)).equals(backupKey)).toBe(true)
  expect(fs.existsSync(`${restored}.prev`)).toBe(false)
})

it('deletes the previous pair when the crash is after both renames', async () => {
  const { restored, backupBytes, backupKey } = await crashAt('keys')
  expect(fs.readFileSync(restored).equals(backupBytes)).toBe(true)
  expect(fs.readFileSync(`${restored}.prev`, 'utf8')).toBe('old-db')
  recoverRestore(restored)
  expect(fs.existsSync(`${restored}.prev`)).toBe(false)
  expect(fs.existsSync(`${restored}-wal.prev`)).toBe(false)
  expect(fs.readFileSync(keyFilePath(restored)).equals(backupKey)).toBe(true)
})

it('openDatabase completes a restore that stopped after the database rename', async () => {
  const { restored } = await crashAt('database')
  const opened = await openDatabase(restored)
  const name = opened.get<{ name: string }>('SELECT name FROM event')
  opened.raw.close()
  expect(name?.name).toBe('Kept')
  expect(fs.existsSync(`${restored}.prev`)).toBe(false)
  expect(fs.existsSync(`${keyFilePath(restored)}.prev`)).toBe(false)
})

it('creates the destination when nothing is there yet', async () => {
  const { dir, backup, backupBytes, backupKey } = await preparedPair()
  const dest = path.join(dir, 'fresh.sqlite')
  expect(await restoreBackupPair(backup, dest, () => {})).toBe(true)
  expect(fs.readFileSync(dest).equals(backupBytes)).toBe(true)
  expect(fs.readFileSync(keyFilePath(dest)).equals(backupKey)).toBe(true)
  expect(fs.existsSync(`${dest}.prev`)).toBe(false)
})

function stampBackup(dir: string, name: string, iso: string, complete: boolean): string {
  const full = path.join(dir, name)
  fs.writeFileSync(full, name)
  const seconds = Date.parse(iso) / 1000
  fs.utimesSync(full, seconds, seconds)
  if (complete) writeKeyStub(keyFilePath(full), FILE_ID)
  else fs.writeFileSync(keyFilePath(full), 'short')
  fs.utimesSync(keyFilePath(full), seconds, seconds)
  return full
}

it('deletes expired incomplete backups', () => {
  const dir = tempDir()
  const now = Date.parse('2028-06-13T00:00:00Z')
  const expired = stampBackup(dir, 'ert-old.sqlite', '2027-01-01T00:00:00Z', false)
  const recent = stampBackup(dir, 'ert-new.sqlite', '2028-06-01T00:00:00Z', false)
  expect(pruneBackups(dir, 12, now)).toContain(expired)
  expect(fs.existsSync(expired)).toBe(false)
  expect(fs.existsSync(recent)).toBe(true)
})

it('keeps the newest sqlite pair when a newer schema backup exists', () => {
  const dir = tempDir()
  const now = Date.parse('2028-06-13T00:00:00Z')
  const newestSqlite = stampBackup(dir, 'ert-race.sqlite', '2027-05-01T00:00:00Z', true)
  const olderSqlite = stampBackup(dir, 'ert-older.sqlite', '2026-01-01T00:00:00Z', true)
  const schemaBak = stampBackup(dir, 'ert.sqlite.v3.bak', '2028-06-01T00:00:00Z', true)
  const removed = pruneBackups(dir, 12, now)
  expect(fs.existsSync(newestSqlite)).toBe(true)
  expect(fs.existsSync(keyFilePath(newestSqlite))).toBe(true)
  expect(removed).toContain(olderSqlite)
  expect(fs.existsSync(schemaBak)).toBe(true)
  expect(removed).not.toContain(newestSqlite)
})

it('does not let incomplete copies fill the recent window', () => {
  const dir = tempDir()
  const now = Date.parse('2028-06-13T00:00:00Z')
  for (let i = 0; i < BACKUP_KEEP_RECENT; i += 1) {
    const iso = new Date(Date.parse('2028-06-12T18:00:00Z') + i * 1000).toISOString()
    stampBackup(dir, `ert-gap-${String(i).padStart(2, '0')}.sqlite`, iso, false)
  }
  const kept = stampBackup(dir, 'ert-complete.sqlite', '2028-06-12T08:00:00Z', true)
  pruneBackups(dir, 12, now)
  expect(fs.existsSync(kept)).toBe(true)
  expect(fs.existsSync(keyFilePath(kept))).toBe(true)
})

it('keeps the newest complete sqlite pair after the retention period', () => {
  const dir = tempDir()
  const now = Date.parse('2028-06-13T00:00:00Z')
  const newest = stampBackup(dir, 'ert-complete.sqlite', '2027-05-01T00:00:00Z', true)
  const older = stampBackup(dir, 'ert-older.sqlite', '2026-01-01T00:00:00Z', true)
  const removed = pruneBackups(dir, 12, now)
  expect(fs.existsSync(newest)).toBe(true)
  expect(removed).toContain(older)
  expect(fs.existsSync(older)).toBe(false)
})
