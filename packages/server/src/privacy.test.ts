import { describe, expect, it } from 'vitest'
import { RESULT_FIELDS } from '@ert/core'
import { openDatabase } from '@ert/storage'
import { packErtx, unpackErtx } from '@ert/sync'
import { createApp } from './app.js'
import { Clock, RaceService } from './service.js'

describe('public results privacy', () => {
  it('hides a hidden name and personal fields, and initials a child', async () => {
    const db = await openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent({
      id: 'EV',
      name: 'Privacy',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      settings: { age_reference_date: '2027-06-12', age_basis: 'birth_date' },
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
    })
    service.registerLate({ firstName: 'Aikuinen', lastName: 'Aiku', gender: 'M', birthDate: '1990-01-01', email: 'adult@example.com', raceId: 'R1', bib: 1, consent: false })
    service.registerLate({ firstName: 'Lotta', lastName: 'Hämäläinen', gender: 'M', birthDate: '2016-01-01', email: 'child@example.com', raceId: 'R1', bib: 2, consent: false })
    service.registerLate({ firstName: 'Nimi', lastName: 'Salainen', gender: 'M', birthDate: '1990-02-02', email: 'secret@example.com', raceId: 'R1', bib: 3, consent: false })
    const hidden = db.get<{ id: string }>('SELECT id FROM person WHERE last_name = ?', 'Salainen')
    db.run(`UPDATE person SET guardian_name = 'Huoltaja Salainen', guardian_email = 'guardian@example.com' WHERE id = ?`, hidden?.id)
    const child = db.get<{ publication: string }>('SELECT publication FROM person WHERE last_name = ?', 'Hämäläinen')
    const adult = db.get<{ publication: string }>('SELECT publication FROM person WHERE last_name = ?', 'Aiku')
    expect(child?.publication).toBe('initials')
    expect(adult?.publication).toBe('full')

    const broadcasts: unknown[] = []
    service.bus.on('TimingEventRecorded', (payload) => broadcasts.push(payload))
    const start = Date.parse('2027-06-12T10:00:00Z')
    service.startRace('R1', start)
    service.recordFinish({ timeMs: start + 60_000, bib: 1 })
    service.recordFinish({ timeMs: start + 70_000, bib: 2 })
    service.recordFinish({ timeMs: start + 80_000, bib: 3 })
    expect(JSON.stringify(broadcasts)).not.toContain('Salainen')
    expect(JSON.stringify(broadcasts)).not.toContain('Lotta')
    expect(JSON.stringify(broadcasts)).not.toContain('Hämäläinen')

    const { app } = createApp({ db, testMode: true })
    const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const auth = { authorization: `Bearer ${session.json().token as string}` }
    await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${hidden?.id}/publication`,
      headers: auth,
      payload: { level: 'hidden' },
    })

    const denied = await app.inject({ method: 'GET', url: '/api/v1/results?view=internal' })
    expect(denied.statusCode).toBe(401)

    const pub = await app.inject({ method: 'GET', url: '/api/v1/results' })
    expect(pub.statusCode).toBe(200)
    const body = JSON.stringify(pub.json())
    expect(body).not.toContain('Salainen')
    expect(body).not.toContain('secret@example.com')
    expect(body).not.toContain('guardian@example.com')
    expect(body).not.toContain('Huoltaja')
    expect(body).not.toContain('2016-01-01')
    expect(body).not.toContain('entryId')
    expect(body).toContain('Aiku Aikuinen')
    expect(body).toContain('L. H.')
    expect(body).not.toContain('Hämäläinen')
    expect(body).not.toContain('Lotta')
    const csv = await app.inject({ method: 'GET', url: '/api/v1/results?format=csv' })
    const html = await app.inject({ method: 'GET', url: '/api/v1/results?format=html' })
    expect(csv.body).toContain('L. H.')
    expect(csv.body).not.toContain('Hämäläinen')
    expect(html.body).toContain('L. H.')
    expect(html.body).not.toContain('Hämäläinen')
    for (const row of pub.json() as Record<string, string>[]) {
      expect(Object.keys(row).sort()).toEqual([...RESULT_FIELDS].sort())
    }

    const internal = await app.inject({ method: 'GET', url: '/api/v1/results?view=internal', headers: auth })
    expect(internal.statusCode).toBe(200)
    expect(JSON.stringify(internal.json())).toContain('Salainen Nimi')

    const remote = await app.inject({ method: 'GET', url: '/api/v1/runtime', remoteAddress: '8.8.8.8' })
    expect(remote.statusCode).toBe(401)
    const local = await app.inject({ method: 'GET', url: '/api/v1/runtime' })
    expect(local.statusCode).toBe(200)

    db.raw.close()
    await app.close()
  })

  it('stores initials when a late entry has no birth date, and when an old archive has an unknown age', async () => {
    const db = await openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent({
      id: 'EV',
      name: 'Privacy',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      settings: { age_reference_date: '2027-06-12', age_basis: 'birth_date' },
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
    })
    service.registerLate({ firstName: 'Aikuinen', lastName: 'Aiku', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false })
    service.registerLate({ firstName: 'Ei', lastName: 'Ikaa', gender: 'M', birthDate: null, raceId: 'R1', bib: 9, consent: false })
    const stored = db.get<{ publication: string }>('SELECT publication FROM person WHERE last_name = ?', 'Ikaa')
    expect(stored?.publication).toBe('initials')

    const unpacked = await unpackErtx(service.exportErtx())
    const data = unpacked.data as { person: Record<string, string | number | null>[] }
    data.person.push({
      id: 'P-UNKNOWN',
      org_id: 'local',
      first_name: 'Vanha',
      last_name: 'Arkisto',
      gender: 'M',
      birth_date: null,
      birth_year: null,
      publication: 'full',
      created_at: 1,
      updated_at: 1,
      rev: 1,
      hlc: '1',
    })
    unpacked.manifest.schema_version = 1
    await service.importErtx(packErtx(data, unpacked.manifest))
    const imported = db.get<{ publication: string }>('SELECT publication FROM person WHERE id = ?', 'P-UNKNOWN')
    const adult = db.get<{ publication: string }>('SELECT publication FROM person WHERE last_name = ?', 'Aiku')
    expect(imported?.publication).toBe('initials')
    expect(adult?.publication).toBe('full')
    db.raw.close()
  })
})
