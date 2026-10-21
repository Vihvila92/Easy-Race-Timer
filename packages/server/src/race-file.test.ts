// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translate } from '@ert/i18n'
import { QUARANTINE_RETENTION_MS, RaceFileError, openDatabase, openPlaintextSqlite } from '@ert/storage'
import { unpackErtx } from '@ert/sync'
import { createApp } from './app.js'
import { formatRaceFileError } from './race-file.js'
import { Clock, RaceService } from './service.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('formatRaceFileError', () => {
  it('uses the locale text and never a directory or a stack', () => {
    const newer = formatRaceFileError(new RaceFileError('race.sqlite', 'newer'), 'fi')
    expect(newer).toBe(`${translate('fi', 'file.newer')} ${translate('fi', 'file.hint.newer')}`)
    const english = formatRaceFileError(new RaceFileError('race.sqlite', 'newer'), 'en')
    expect(english).toContain('newer Easy Race Timer')
    expect(english).toContain('not damaged')
    const open = formatRaceFileError(new RaceFileError('race.sqlite', 'open'), 'en')
    expect(open).toBe(`${translate('en', 'file.openFailed', { name: 'race.sqlite' })} ${translate('en', 'file.hint.openFailed')}`)
    const openFi = formatRaceFileError(new RaceFileError('race.sqlite', 'open'), 'fi')
    expect(openFi).toBe(`${translate('fi', 'file.openFailed', { name: 'race.sqlite' })} ${translate('fi', 'file.hint.openFailed')}`)
    expect(openFi).not.toContain('/')
    expect(open).not.toContain('/')
    expect(open).not.toContain('node:')
    expect(formatRaceFileError(new RaceFileError('', 'dev-key'))).toBe('Dev key provider is disabled in production.')
    expect(formatRaceFileError(new RaceFileError('', 'missing-key'), 'en')).toBe(translate('en', 'file.missingKey'))
    expect(formatRaceFileError(new RaceFileError('', 'missing-key'), 'fi')).toBe(translate('fi', 'file.missingKey'))
    expect(formatRaceFileError(new RaceFileError('', 'missing-key'), 'fi')).not.toContain('/')
  })

  it('maps an unrecoverable plaintext leftover to the openFailed text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-open-failed-'))
    dirs.push(dir)
    const file = path.join(dir, 'ert.sqlite')
    fs.writeFileSync(`${file}.encrypting`, Buffer.from('not a database, and not empty'))
    const error = await openDatabase(file).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(RaceFileError)
    const english = formatRaceFileError(error, 'en')
    const finnish = formatRaceFileError(error, 'fi')
    expect(english).toBe(`${translate('en', 'file.openFailed', { name: 'ert.sqlite' })} ${translate('en', 'file.hint.openFailed')}`)
    expect(finnish).toBe(`${translate('fi', 'file.openFailed', { name: 'ert.sqlite' })} ${translate('fi', 'file.hint.openFailed')}`)
    expect(english).not.toContain(dir)
    expect(finnish).not.toContain(dir)
    expect(english).not.toContain('could not be recovered')
  })
})

describe('race file privacy columns', () => {
  it('stores the birth year and consent date, and keeps the DSQ reason out of exports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-race-file-'))
    dirs.push(dir)
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    const clock = new Clock()
    clock.set(Date.parse('2027-06-12T08:30:00.000Z'))
    const service = new RaceService(db, clock)
    service.importEvent({
      id: 'EV',
      name: 'File',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      settings: { age_reference_date: '2027-06-12', age_basis: 'birth_date' },
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
      categories: [{ id: 'N', race_id: 'R1', name: { fi: 'N', en: 'F' }, gender: 'F', min_age: 0 }],
    })
    service.registerLate({
      firstName: 'Liisa',
      lastName: 'Testi',
      gender: 'F',
      birthDate: '2016-05-02',
      email: 'liisa@example.com',
      raceId: 'R1',
      bib: 7,
      consent: true,
    })

    const columns = db.all<{ name: string }>('PRAGMA table_info(person)').map((column) => column.name)
    expect(columns).not.toContain('birth_date')
    expect(db.get('SELECT birth_year, email FROM person')).toEqual({ birth_year: 2016, email: 'liisa@example.com' })
    const registered = db.get<{ consent_date: string; dsq_reason: string | null }>('SELECT consent_date, dsq_reason FROM entry')
    expect(registered?.consent_date).toBe('2027-06-12')
    expect(registered?.dsq_reason).toBeNull()

    service.setStatus(7, 'dsq', 'internal-dq-note')
    expect(db.get('SELECT status_reason, dsq_reason FROM entry')).toEqual({ status_reason: null, dsq_reason: 'internal-dq-note' })
    service.setStatus(7, 'dns', 'did not start')
    expect(db.get('SELECT status_reason, dsq_reason FROM entry')).toEqual({ status_reason: 'did not start', dsq_reason: null })
    service.setStatus(7, 'dsq', 'internal-dq-note')

    expect(service.resultsCsv()).not.toContain('internal-dq-note')
    expect(service.resultsCsv()).not.toContain('dsq_reason')
    expect(service.resultsHtml()).not.toContain('internal-dq-note')
    expect(service.resultsHtml()).not.toContain('dsq_reason')
    const personId = db.get<{ id: string }>('SELECT id FROM person')?.id
    expect(JSON.stringify(service.exportPerson(personId!))).not.toContain('internal-dq-note')
    expect(JSON.stringify(service.exportPerson(personId!))).not.toContain('dsq_reason')

    db.run(
      `INSERT INTO correction (id, org_id, target_type, target_id, action, old_value_json, new_value_json, reason, hlc, created_at)
       VALUES ('legacy-dq', 'local', 'entry', 'e1', 'set_status', ?, ?, 'internal-dq-note', '1', 1)`,
      JSON.stringify({ status: 'registered' }),
      JSON.stringify({ status: 'dsq' }),
    )
    const archived = await unpackErtx(service.exportErtx())
    const archive = JSON.stringify(archived.data)
    expect(archive).not.toContain('internal-dq-note')
    expect(archive).not.toContain('dsq_reason')
    const corrections = (archived.data as { correction: { action: string; reason: string; new_value_json: string }[] }).correction
    expect(corrections.filter((row) => row.new_value_json.includes('"dsq"')).every((row) => row.reason === 'set_status:dsq')).toBe(true)

    db.raw.close()
    for (const name of fs.readdirSync(dir)) {
      const bytes = fs.readFileSync(path.join(dir, name))
      expect(bytes.includes(Buffer.from('2016-05-02'))).toBe(false)
      expect(bytes.includes(Buffer.from('liisa@example.com'))).toBe(false)
      expect(bytes.includes(Buffer.from('Liisa'))).toBe(false)
    }
  })
})

describe('plaintext quarantine flag', () => {
  it('reports quarantined plaintext on health and leaves a foreign database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-quarantine-'))
    dirs.push(dir)
    const backups = path.join(dir, 'backups')
    fs.mkdirSync(backups)
    const writeNotes = (target: string) => {
      const notes = openPlaintextSqlite(target)
      notes.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)')
      notes.prepare('INSERT INTO notes (body) VALUES (?)').run('foreign')
      notes.close()
    }
    writeNotes(path.join(dir, 'notes.sqlite'))
    writeNotes(path.join(backups, 'notes.sqlite'))
    const legacy = openPlaintextSqlite(path.join(dir, 'ert-legacy.sqlite'))
    legacy.exec(`CREATE TABLE schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      installation_id TEXT NOT NULL
    )`)
    legacy.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, 4, ?, ?)').run('0.1.0', 'install')
    legacy.close()
    const before = fs.readFileSync(path.join(dir, 'notes.sqlite'))
    const beforeBackup = fs.readFileSync(path.join(backups, 'notes.sqlite'))
    const db = await openDatabase(path.join(dir, 'ert.sqlite'))
    expect(fs.readFileSync(path.join(dir, 'notes.sqlite')).equals(before)).toBe(true)
    expect(fs.readFileSync(path.join(backups, 'notes.sqlite')).equals(beforeBackup)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'plaintext-quarantine', 'ert-legacy.sqlite'))).toBe(true)
    expect(db.quarantinedPlaintext).toEqual(['ert-legacy.sqlite'])
    const { app } = await createApp({ db, testMode: true })
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json().plaintextQuarantine).toBe(true)
    await app.close()
    db.raw.close()

    const again = await openDatabase(path.join(dir, 'ert.sqlite'))
    expect(again.quarantinedPlaintext).toEqual([])
    const second = await createApp({ db: again, testMode: true })
    const still = await second.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(still.json().plaintextQuarantine).toBe(true)
    const anonymous = await second.app.inject({
      method: 'POST',
      url: '/api/v1/plaintext-quarantine/delete',
      headers: { host: 'localhost:80' },
      payload: { confirm: true },
    })
    expect(anonymous.statusCode).toBe(401)
    const session = await second.app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const auth = { authorization: `Bearer ${session.json().token as string}`, host: 'localhost:80' }
    for (const payload of [{}, { confirm: false }, { confirm: 'true' }]) {
      const refused = await second.app.inject({
        method: 'POST',
        url: '/api/v1/plaintext-quarantine/delete',
        headers: auth,
        payload,
      })
      expect(refused.statusCode, JSON.stringify(payload)).toBe(400)
      expect(refused.json().error.code).toBe('VALIDATION_ERROR')
    }
    expect(fs.existsSync(path.join(dir, 'plaintext-quarantine', 'ert-legacy.sqlite'))).toBe(true)
    expect(second.service.audit().some((row) => row.action === 'plaintext_quarantine_delete')).toBe(false)
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message))
    })
    const deleted = await second.app.inject({
      method: 'POST',
      url: '/api/v1/plaintext-quarantine/delete',
      headers: auth,
      payload: { confirm: true },
    })
    spy.mockRestore()
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().deleted).toEqual(['ert-legacy.sqlite'])
    const audit = second.service.audit().filter((row) => row.action === 'plaintext_quarantine_delete')
    expect(audit).toHaveLength(1)
    expect(audit[0].reason).toBe('deleted 1')
    expect(audit[0].new_value_json).toBe(JSON.stringify({ count: 1 }))
    expect(JSON.stringify(audit[0])).not.toContain('ert-legacy')
    expect(JSON.stringify(audit[0])).not.toContain('.sqlite')
    expect(warnings.join('\n')).toContain('overwritten where the filesystem allows')
    expect(warnings.join('\n')).not.toContain(dir)
    const cleared = await second.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(cleared.json().plaintextQuarantine).toBe(false)
    expect(fs.readdirSync(path.join(dir, 'plaintext-quarantine'))).toEqual([])
    await second.app.close()
    again.raw.close()

    const memory = await openDatabase(':memory:')
    const memoryApp = await createApp({ db: memory, testMode: true })
    const memoryHealth = await memoryApp.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(memoryHealth.json().plaintextQuarantine).toBe(false)
    await memoryApp.app.close()
    memory.raw.close()
  })

  it('clears the quarantine flag after the retention period on the next startup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-quarantine-expire-'))
    dirs.push(dir)
    const legacy = openPlaintextSqlite(path.join(dir, 'ert-legacy.sqlite'))
    legacy.exec(`CREATE TABLE schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      installation_id TEXT NOT NULL
    )`)
    legacy.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, 4, ?, ?)').run('0.1.0', 'install')
    legacy.close()
    const db = await openDatabase(path.join(dir, 'ert.sqlite'))
    db.raw.close()
    const quarantined = path.join(dir, 'plaintext-quarantine', 'ert-legacy.sqlite')
    expect(fs.existsSync(quarantined)).toBe(true)
    const expired = new Date(Date.now() - QUARANTINE_RETENTION_MS - 60_000)
    fs.utimesSync(quarantined, expired, expired)
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message))
    })
    const again = await openDatabase(path.join(dir, 'ert.sqlite'))
    spy.mockRestore()
    expect(fs.existsSync(quarantined)).toBe(false)
    expect(warnings.join('\n')).toContain('ert-legacy.sqlite')
    expect(warnings.join('\n')).toContain('overwritten where the filesystem allows')
    expect(warnings.join('\n')).not.toContain(dir)
    const { app } = await createApp({ db: again, testMode: true })
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(health.json().plaintextQuarantine).toBe(false)
    await app.close()
    again.raw.close()
  })
})
