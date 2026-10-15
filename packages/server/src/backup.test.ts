import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { runScheduledBackup, writeBackup } from './backup.js'

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
    const { service, app: setup } = createApp({ db })
    service.registerLate({
      firstName: 'A', lastName: 'B', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false,
    })
    const reasons: string[] = []
    const blocked = await setup.inject({
      method: 'POST',
      url: '/api/v1/races/R1/lock',
      payload: {},
    })
    expect(blocked.statusCode).toBe(409)
    expect(reasons).toEqual([])

    service.setStatus(1, 'dns', 'test')
    const { app: ok } = createApp({
      db,
      backup: async (reason) => { reasons.push(reason) },
    })
    const locked = await ok.inject({
      method: 'POST',
      url: '/api/v1/races/R1/lock',
      payload: {},
    })
    expect(locked.statusCode).toBe(200)
    expect(reasons).toEqual(['lock'])

    service.unlockRace('R1', 'test')
    const { app: failing } = createApp({
      db,
      backup: async () => { throw new Error('disk full') },
    })
    const failed = await failing.inject({
      method: 'POST',
      url: '/api/v1/races/R1/lock',
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
