import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { peekSchemaVersion } from './cipher.js'
import { assertBackupIntegrity, backupDatabase, migrationHooks, openDatabase, pruneBackups } from './db.js'
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
  })

  it('rejects a file that is not a database', () => {
    const dir = tempDir()
    const file = path.join(dir, 'notes.sqlite')
    fs.writeFileSync(file, 'not a database')
    expect(() => assertBackupIntegrity(file)).toThrow(/integrity check failed/i)
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
    const removed = pruneBackups(dir, 12, now)
    expect(removed).toEqual([oldFile])
    expect(fs.existsSync(oldFile)).toBe(false)
    expect(fs.existsSync(newFile)).toBe(true)
  })
})
