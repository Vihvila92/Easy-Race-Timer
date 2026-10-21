import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { translate } from '@ert/i18n'
import { RaceFileError, openDatabase } from '@ert/storage'
import { unpackErtx } from '@ert/sync'
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
    expect(open).toBe(translate('en', 'file.openFailed', { name: 'race.sqlite' }))
    expect(open).not.toContain('/')
    expect(open).not.toContain('node:')
    expect(formatRaceFileError(new RaceFileError('', 'dev-key'))).toBe('Dev key provider is disabled in production.')
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

    const archived = await unpackErtx(service.exportErtx())
    const entries = JSON.stringify((archived.data as { entry: unknown[] }).entry)
    expect(entries).not.toContain('internal-dq-note')
    expect(entries).not.toContain('dsq_reason')

    db.raw.close()
    for (const name of fs.readdirSync(dir)) {
      const bytes = fs.readFileSync(path.join(dir, name))
      expect(bytes.includes(Buffer.from('2016-05-02'))).toBe(false)
      expect(bytes.includes(Buffer.from('liisa@example.com'))).toBe(false)
      expect(bytes.includes(Buffer.from('Liisa'))).toBe(false)
    }
  })
})
