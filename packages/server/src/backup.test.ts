// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { keyFilePath, openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { restoreBackup, runScheduledBackup, writeBackup } from './backup.js'
import { windowsPrivateDirectoryArgs } from './private-dir.js'
import { Clock, RaceService } from './service.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-bak-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function fileDb() {
  const dir = tempDir()
  const db = await openDatabase(path.join(dir, 'ert.sqlite'))
  db.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
    VALUES ('EV', 'local', 'Test', '2027-06-12', 'Europe/Helsinki', 'run', '{"retention_months":12}', 1, 1, '1')`)
  return { dir, db }
}

describe('writeBackup', () => {
  it('stores a consistent file and logs a scheduled failure', async () => {
    const { dir, db } = await fileDb()
    const backupDir = path.join(dir, 'backups')
    const dest = await writeBackup(db, backupDir, 'lock')
    expect(fs.existsSync(dest)).toBe(true)
    expect(path.basename(dest)).toContain('-lock.sqlite')
    const logs: string[] = []
    db.raw.close()
    fs.rmSync(path.join(dir, 'ert.sqlite'))
    const missing = await openDatabase(':memory:')
    await runScheduledBackup(missing, backupDir, (message) => logs.push(message))
    expect(logs[0]).toMatch(/Scheduled backup failed/)
    missing.raw.close()
  })
})

describe('lock backup', () => {
  it('waits for the backup and surfaces a failure', async () => {
    const { db } = await fileDb()
    db.run(`INSERT INTO race (id, org_id, event_id, name_fi, name_en, distance_m, start_mode, created_at, updated_at, hlc)
      VALUES ('R1', 'local', 'EV', '1 km', '1 km', 1000, 'mass', 1, 1, '1')`)
    db.run(`INSERT INTO category (id, race_id, code, name_fi, name_en, gender, min_age, ranked, auto_assign, sort_order)
      VALUES ('M', 'R1', 'M', 'M', 'M', 'M', 16, 1, 1, 0)`)
    const { service, app: setup } = await createApp({ db })
    service.registerLate({
      firstName: 'A', lastName: 'B', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false,
    })
    const reasons: string[] = []
    const session = await setup.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const auth = { authorization: `Bearer ${session.json().token as string}` }
    const blocked = await setup.inject({
      method: 'POST',
      url: '/api/v1/races/R1/lock',
      headers: auth,
      payload: {},
    })
    expect(blocked.statusCode).toBe(409)
    expect(reasons).toEqual([])

    service.setStatus(1, 'dns', 'test')
    const { app: ok } = await createApp({
      db,
      backup: async (reason) => { reasons.push(reason) },
    })
    const locked = await ok.inject({
      method: 'POST',
      url: '/api/v1/races/R1/lock',
      headers: auth,
      payload: {},
    })
    expect(locked.statusCode).toBe(200)
    expect(reasons).toEqual(['lock'])

    service.unlockRace('R1', 'test')
    const { app: failing } = await createApp({
      db,
      backup: async () => { throw new Error('disk full') },
    })
    const failed = await failing.inject({
      method: 'POST',
      url: '/api/v1/races/R1/lock',
      headers: auth,
      payload: {},
    })
    expect(failed.statusCode).toBe(500)
    expect(failed.json()).toMatchObject({ error: { code: 'BACKUP_FAILED', message: 'disk full' } })
    db.raw.close()
    await setup.close()
    await ok.close()
    await failing.close()
  })
})

const PAST = Date.parse('2028-06-13T12:00:00+03:00')
const EARLY = Date.parse('2027-06-13T12:00:00+03:00')

function firstNames(db: { all: <T>(sql: string) => T[] }): string[] {
  return db.all<{ first_name: string }>('SELECT first_name FROM person ORDER BY first_name').map((row) => row.first_name)
}

async function peopleDb() {
  const dir = tempDir()
  const db = await openDatabase(path.join(dir, 'ert.sqlite'))
  const service = new RaceService(db, new Clock())
  service.importEvent({
    id: 'EV',
    name: 'Retention',
    date: '2027-06-12',
    timezone: 'Europe/Helsinki',
    sport: 'run',
    races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
    categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 16 }],
  })
  service.registerLate({
    firstName: 'Aino', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', email: 'aino@example.test', raceId: 'R1', bib: 1, consent: false,
  })
  service.registerLate({
    firstName: 'Pekka', lastName: 'Suoja', gender: 'M', birthDate: '1988-04-04', raceId: 'R1', bib: 2, consent: true,
  })
  return { dir, db }
}

describe('backup directory permissions', () => {
  it('creates the backup directory with mode 0700', async () => {
    const { dir, db } = await fileDb()
    const loose = path.join(dir, 'backups')
    fs.mkdirSync(loose, { mode: 0o755 })
    fs.chmodSync(loose, 0o755)
    await writeBackup(db, loose, 'lock')
    const fresh = path.join(dir, 'fresh-backups')
    await writeBackup(db, fresh, 'schedule', new Date('2028-01-02T03:04:05.000Z'))
    db.raw.close()
    expect(fs.statSync(loose).isDirectory()).toBe(true)
    expect(fs.statSync(fresh).isDirectory()).toBe(true)
    // Windows has no POSIX mode bits. The ACL test below is the equivalent.
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return
    expect(fs.statSync(loose).mode & 0o777).toBe(0o700)
    expect(fs.statSync(fresh).mode & 0o777).toBe(0o700)
  })

  it('documents the Windows ACL equivalent of backup directory mode 0700', () => {
    // Node ignores the mode argument on Windows, so mkdir 0700 does not restrict the DACL.
    // The equivalent removes inherited ACEs and grants only the current user full control:
    // icacls <backup-dir> /inheritance:r /grant:r "<user>:(OI)(CI)F"
    const dir = 'C:\\Users\\Volunteer\\AppData\\Roaming\\Easy Race Timer\\backups'
    expect(windowsPrivateDirectoryArgs(dir, 'Volunteer')).toEqual([
      dir,
      '/inheritance:r',
      '/grant:r',
      'Volunteer:(OI)(CI)F',
    ])
  })
})

describe('restoreBackup', () => {
  it('anonymises a restored file before the caller opens it', async () => {
    const { dir, db } = await peopleDb()
    const backup = await writeBackup(db, path.join(dir, 'backups'), 'manual')
    const dest = path.join(dir, 'restored.sqlite')
    // The race is not locked. On restore the deadline alone decides.
    const steps: string[] = []
    const restored = await restoreBackup(backup, dest, db.dataKey!, PAST)
    steps.push(restored ? 'restored' : 'skipped')
    const opened = await openDatabase(dest, { dataKey: db.dataKey! })
    steps.push('opened')
    expect(steps).toEqual(['restored', 'opened'])
    expect(firstNames(opened)).toEqual(['Pekka'])
    expect(opened.get("SELECT COUNT(*) AS n FROM person WHERE email = 'aino@example.test'")).toEqual({ n: 0 })
    expect(opened.all('SELECT display_name, bib FROM entry WHERE anonymized_at IS NOT NULL')).toEqual([{ display_name: null, bib: null }])
    expect(opened.all('SELECT display_name, bib FROM entry WHERE anonymized_at IS NULL')).toEqual([{ display_name: 'Suoja Pekka', bib: 2 }])
    expect(opened.get<{ anonymized_at: number }>('SELECT anonymized_at FROM entry WHERE anonymized_at IS NOT NULL')?.anonymized_at).toBe(PAST)
    expect(opened.get("SELECT COUNT(*) AS n FROM correction WHERE action = 'retention'")).toEqual({ n: 1 })
    opened.raw.close()
    const backupDb = await openDatabase(backup, { dataKey: db.dataKey! })
    expect(firstNames(backupDb)).toEqual(['Aino', 'Pekka'])
    backupDb.raw.close()
    expect(firstNames(db)).toEqual(['Aino', 'Pekka'])
    db.raw.close()
  })

  it('leaves a restored file unchanged when the retention deadline has not passed', async () => {
    const { dir, db } = await peopleDb()
    const backup = await writeBackup(db, path.join(dir, 'backups'), 'manual')
    const dest = path.join(dir, 'restored.sqlite')
    expect(await restoreBackup(backup, dest, db.dataKey!, EARLY)).toBe(true)
    const opened = await openDatabase(dest, { dataKey: db.dataKey! })
    expect(firstNames(opened)).toEqual(['Aino', 'Pekka'])
    expect(opened.get("SELECT COUNT(*) AS n FROM entry WHERE anonymized_at IS NOT NULL")).toEqual({ n: 0 })
    expect(opened.get("SELECT COUNT(*) AS n FROM correction WHERE action = 'retention'")).toEqual({ n: 0 })
    opened.raw.close()
    db.raw.close()
  })

  it('keeps a restored file that has no event to anonymise', async () => {
    const dir = tempDir()
    const db = await openDatabase(path.join(dir, 'ert.sqlite'))
    const backup = await writeBackup(db, path.join(dir, 'backups'), 'empty')
    const dest = path.join(dir, 'restored.sqlite')
    expect(await restoreBackup(backup, dest, db.dataKey!, PAST)).toBe(true)
    const opened = await openDatabase(dest, { dataKey: db.dataKey! })
    expect(opened.get('SELECT COUNT(*) AS n FROM event')).toEqual({ n: 0 })
    expect(fs.existsSync(dest)).toBe(true)
    opened.raw.close()
    db.raw.close()
  })

  it('does not replace the destination when the backup pair is incomplete', async () => {
    const { dir, db } = await fileDb()
    const backup = await writeBackup(db, path.join(dir, 'backups'), 'manual')
    fs.rmSync(keyFilePath(backup))
    const dest = path.join(dir, 'restored.sqlite')
    fs.writeFileSync(dest, 'keep')
    expect(await restoreBackup(backup, dest, db.dataKey!, PAST)).toBe(false)
    expect(fs.readFileSync(dest, 'utf8')).toBe('keep')
    db.raw.close()
  })
})
