// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { peekSchemaVersion } from './cipher.js'
import { assertBackupIntegrity, backupDatabase, migrationHooks, openDatabase, pruneBackups, pruneSchemaBackups, restoreBackupPair } from './db.js'
import { keyFilePath } from './key-file.js'
import { devDataKey } from './key.js'
import { SCHEMA_VERSION } from './schema.js'

const files: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-db-'))
  files.push(dir)
  return dir
}

afterEach(() => {
  migrationHooks.beforeCommit = undefined
  migrationHooks.failBackup = false
  for (const file of files.splice(0)) fs.rmSync(file, { recursive: true, force: true })
})

describe('backupDatabase', () => {
  it('writes an encrypted backup that opens with the same key and passes integrity_check', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
      VALUES ('EV', 'local', 'Test', '2027-06-12', 'Europe/Helsinki', 'run', '{}', 1, 1, '1')`)
    const dest = path.join(dir, 'backups', 'copy.sqlite')
    await backupDatabase(db, dest)
    db.raw.close()
    const copy = await openDatabase(dest)
    const row = copy.get<{ name: string }>('SELECT name FROM event')
    const integrity = copy.raw.pragma('integrity_check', { simple: true })
    copy.raw.close()
    expect(row?.name).toBe('Test')
    expect(integrity).toBe('ok')
    expect(assertBackupIntegrity(dest, devDataKey())).toBeUndefined()
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(keyFilePath(dest)).equals(fs.readFileSync(keyFilePath(file)))).toBe(true)
    expect(fs.statSync(keyFilePath(dest)).mode & 0o777).toBe(0o600)
  })

  it('copies the key file with the database and with the pre-migration backup', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    const sidecar = fs.readFileSync(keyFilePath(file))
    db.run('UPDATE schema_meta SET schema_version = 3')
    const dest = path.join(dir, 'usb', 'copy.sqlite')
    await backupDatabase(db, dest)
    expect(fs.readFileSync(keyFilePath(dest)).equals(sidecar)).toBe(true)
    expect(fs.statSync(keyFilePath(dest)).mode & 0o777).toBe(0o600)
    db.raw.close()
    const before = fs.readFileSync(file)
    await openDatabase(file).then((migrated) => migrated.raw.close())
    const keyBak = path.join(dir, 'ert.sqlite.v3.keys')
    expect(fs.readFileSync(keyBak).equals(sidecar)).toBe(true)
    expect(fs.statSync(keyBak).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(path.join(dir, 'ert.sqlite.v3.bak')).equals(before)).toBe(true)
    expect(fs.readFileSync(keyFilePath(file)).equals(sidecar)).toBe(true)
  })

  it('skips a backup pair that is missing its key file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    const dest = path.join(dir, 'backups', 'copy.sqlite')
    await backupDatabase(db, dest)
    db.raw.close()
    fs.rmSync(keyFilePath(dest))
    const restored = path.join(dir, 'restored.sqlite')
    fs.writeFileSync(restored, 'keep')
    expect(restoreBackupPair(dest, restored)).toBe(false)
    expect(fs.readFileSync(restored, 'utf8')).toBe('keep')
    expect(fs.existsSync(keyFilePath(restored))).toBe(false)
    fs.writeFileSync(keyFilePath(dest), fs.readFileSync(keyFilePath(file)))
    expect(restoreBackupPair(dest, restored)).toBe(true)
    expect(fs.readFileSync(keyFilePath(restored)).equals(fs.readFileSync(keyFilePath(file)))).toBe(true)
    const opened = await openDatabase(restored)
    opened.raw.close()
  })

  it('rejects a file that is not a database', () => {
    const dir = tempDir()
    const file = path.join(dir, 'notes.sqlite')
    fs.writeFileSync(file, 'not a database')
    expect(() => assertBackupIntegrity(file, Buffer.alloc(32, 0x22))).toThrow(/integrity check failed/i)
  })

  it('does not fall back to copying the live file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    const blocker = path.join(dir, 'not-dir')
    fs.writeFileSync(blocker, 'x')
    await expect(backupDatabase(db, path.join(blocker, 'copy.sqlite'))).rejects.toThrow(/Backup failed/)
    db.raw.close()
    expect(fs.readFileSync(blocker, 'utf8')).toBe('x')
  })
})

describe('openDatabase', () => {
  it('does not migrate when the pre-migration backup fails', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('UPDATE schema_meta SET schema_version = 0')
    db.raw.close()
    migrationHooks.failBackup = true
    await expect(openDatabase(file)).rejects.toThrow(/Pre-migration backup failed/)
    migrationHooks.failBackup = false
    expect(peekSchemaVersion(file, devDataKey())).toBe(0)
  })

  it('backs up the exact pre-migration bytes and then applies a pending migration', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('UPDATE schema_meta SET schema_version = 0')
    db.raw.close()
    const before = fs.readFileSync(file)
    const reopened = await openDatabase(file)
    const version = reopened.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')
    reopened.raw.close()
    expect(version?.schema_version).toBe(SCHEMA_VERSION)
    const backups = fs.readdirSync(dir).filter((name) => name.includes('.v0.bak'))
    expect(backups).toHaveLength(1)
    const backup = path.join(dir, backups[0]!)
    expect(fs.readFileSync(backup).equals(before)).toBe(true)
    expect(assertBackupIntegrity(backup, devDataKey())).toBeUndefined()
  })

  it('leaves the original bytes in place when a migration fails', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('UPDATE schema_meta SET schema_version = 3')
    db.raw.close()
    const before = fs.readFileSync(file)
    migrationHooks.beforeCommit = () => {
      throw new Error('disk')
    }
    await expect(openDatabase(file)).rejects.toThrow(/left unchanged/)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    const backups = fs.readdirSync(dir).filter((name) => name.endsWith('.v3.bak'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]!)).equals(before)).toBe(true)
    expect(peekSchemaVersion(file, devDataKey())).toBe(3)
  })

  it('sets initials for a person whose age is unknown when migrating from schema 2', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('UPDATE schema_meta SET schema_version = 2')
    db.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
      VALUES ('EV', 'local', 'Test', '2027-06-12', 'Europe/Helsinki', 'run', ?, 1, 1, '1')`, JSON.stringify({ age_basis: 'birth_date', age_reference_date: '2027-06-12' }))
    const insert = db.raw.prepare(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES (?, ?, ?, 'M', ?, 'full', 1, 1, '1')`)
    insert.run('unknown', 'Tuntematon', 'Ika', null)
    insert.run('adult', 'Aikuinen', 'Aiku', 1990)
    db.raw.close()
    const reopened = await openDatabase(file)
    const unknown = reopened.get<{ publication: string }>('SELECT publication FROM person WHERE id = ?', 'unknown')
    const adult = reopened.get<{ publication: string }>('SELECT publication FROM person WHERE id = ?', 'adult')
    reopened.raw.close()
    expect(unknown?.publication).toBe('initials')
    expect(adult?.publication).toBe('full')
  })
})

describe('pruneBackups', () => {
  it('removes files older than the retention period', () => {
    const dir = tempDir()
    const oldFile = path.join(dir, 'ert-old.sqlite')
    const newFile = path.join(dir, 'ert-new.sqlite')
    fs.writeFileSync(oldFile, 'old')
    fs.writeFileSync(newFile, 'new')
    const now = Date.parse('2028-06-13T00:00:00Z')
    fs.utimesSync(oldFile, now / 1000, Date.parse('2027-06-01T00:00:00Z') / 1000)
    fs.utimesSync(newFile, now / 1000, Date.parse('2028-01-01T00:00:00Z') / 1000)
    const oldBak = path.join(dir, 'ert.sqlite.v3.bak')
    const oldKey = path.join(dir, 'ert-old.keys')
    const oldBakKey = path.join(dir, 'ert.sqlite.v3.keys')
    const newKey = path.join(dir, 'ert-new.keys')
    fs.writeFileSync(oldBak, 'bak')
    fs.writeFileSync(oldKey, 'old-key')
    fs.writeFileSync(oldBakKey, 'bak-key')
    fs.writeFileSync(newKey, 'new-key')
    fs.utimesSync(oldBak, now / 1000, Date.parse('2027-06-01T00:00:00Z') / 1000)
    fs.utimesSync(oldKey, now / 1000, Date.parse('2027-06-01T00:00:00Z') / 1000)
    fs.utimesSync(oldBakKey, now / 1000, Date.parse('2027-06-01T00:00:00Z') / 1000)
    const removed = pruneBackups(dir, 12, now)
    expect(removed.sort()).toEqual([oldBak, oldBakKey, oldFile, oldKey].sort())
    expect(fs.existsSync(oldFile)).toBe(false)
    expect(fs.existsSync(oldBak)).toBe(false)
    expect(fs.existsSync(oldKey)).toBe(false)
    expect(fs.existsSync(oldBakKey)).toBe(false)
    expect(fs.existsSync(newFile)).toBe(true)
    expect(fs.existsSync(newKey)).toBe(true)
    const live = path.join(dir, 'ert.sqlite')
    const liveKey = path.join(dir, 'ert.keys')
    const aged = path.join(dir, 'ert.sqlite.v2.bak')
    const agedKey = path.join(dir, 'ert.sqlite.v2.keys')
    fs.writeFileSync(live, 'live')
    fs.writeFileSync(liveKey, 'live-key')
    fs.writeFileSync(aged, 'aged')
    fs.writeFileSync(agedKey, 'aged-key')
    fs.utimesSync(aged, now / 1000, Date.parse('2027-01-01T00:00:00Z') / 1000)
    fs.utimesSync(agedKey, now / 1000, Date.parse('2028-01-01T00:00:00Z') / 1000)
    expect(pruneSchemaBackups(dir, 12, now).sort()).toEqual([aged, agedKey].sort())
    expect(fs.existsSync(live)).toBe(true)
    expect(fs.existsSync(liveKey)).toBe(true)
    expect(fs.existsSync(aged)).toBe(false)
    expect(fs.existsSync(agedKey)).toBe(false)
  })
})
