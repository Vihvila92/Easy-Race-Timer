// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { assertBackupIntegrity, backupDatabase, openDatabase, pruneBackups } from './db.js'
import { SCHEMA_VERSION } from './schema.js'

const files: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-db-'))
  files.push(dir)
  return dir
}

afterEach(() => {
  for (const file of files.splice(0)) fs.rmSync(file, { recursive: true, force: true })
})

describe('backupDatabase', () => {
  it('writes a backup that opens and passes integrity_check', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
      VALUES ('EV', 'local', 'Test', '2027-06-12', 'Europe/Helsinki', 'run', '{}', 1, 1, '1')`)
    const dest = path.join(dir, 'backups', 'copy.sqlite')
    await backupDatabase(db, dest)
    const copy = new Database(dest, { readonly: true })
    const row = copy.prepare('SELECT name FROM event').get() as { name: string }
    const integrity = copy.pragma('integrity_check', { simple: true })
    copy.close()
    db.raw.close()
    expect(row.name).toBe('Test')
    expect(integrity).toBe('ok')
    expect(assertBackupIntegrity(dest)).toBeUndefined()
  })

  it('rejects a file that is not a database', () => {
    const dir = tempDir()
    const file = path.join(dir, 'notes.sqlite')
    fs.writeFileSync(file, 'not a database')
    expect(() => assertBackupIntegrity(file)).toThrow(/integrity check failed|not a database|file is not a database/i)
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
    db.raw.close()
    const raw = new Database(file)
    raw.prepare('UPDATE schema_meta SET schema_version = 0').run()
    raw.close()
    const original = Database.prototype.backup
    Database.prototype.backup = () => Promise.reject(new Error('disk full'))
    try {
      await expect(openDatabase(file)).rejects.toThrow(/Pre-migration backup failed/)
    } finally {
      Database.prototype.backup = original
    }
    const check = new Database(file, { readonly: true })
    const version = check.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get() as { schema_version: number }
    check.close()
    expect(version.schema_version).toBe(0)
  })

  it('backs up and then applies a pending migration', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.raw.close()
    const raw = new Database(file)
    raw.prepare('UPDATE schema_meta SET schema_version = 0').run()
    raw.close()
    const reopened = await openDatabase(file)
    const version = reopened.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')
    reopened.raw.close()
    expect(version?.schema_version).toBe(SCHEMA_VERSION)
    const backups = fs.readdirSync(dir).filter((name) => name.includes('.premigrate-') && name.endsWith('.sqlite'))
    expect(backups).toHaveLength(1)
    expect(() => assertBackupIntegrity(path.join(dir, backups[0]!))).not.toThrow()
  })

  it('sets initials for a person whose age is unknown when migrating from schema 2', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.raw.close()
    const raw = new Database(file)
    raw.prepare('UPDATE schema_meta SET schema_version = 2').run()
    raw.prepare(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
      VALUES ('EV', 'local', 'Test', '2027-06-12', 'Europe/Helsinki', 'run', ?, 1, 1, '1')`).run(JSON.stringify({ age_basis: 'birth_date', age_reference_date: '2027-06-12' }))
    const insert = raw.prepare(`INSERT INTO person (id, first_name, last_name, gender, birth_date, birth_year, publication, created_at, updated_at, hlc)
      VALUES (?, ?, ?, 'M', ?, ?, 'full', 1, 1, '1')`)
    insert.run('unknown', 'Tuntematon', 'Ika', null, null)
    insert.run('adult', 'Aikuinen', 'Aiku', '1990-01-01', 1990)
    raw.close()
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
