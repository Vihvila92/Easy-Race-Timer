// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

async function fixture() {
  const db = await openDatabase(':memory:')
  const { app, service } = await createApp({ db, testMode: true })
  service.importEvent({
    id: 'EV',
    name: 'Consent',
    date: '2027-06-12',
    timezone: 'Europe/Helsinki',
    sport: 'run',
    settings: { age_reference_date: '2027-06-12', age_basis: 'birth_date' },
    races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
    categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
  })
  service.registerLate({ firstName: 'Aikuinen', lastName: 'Aiku', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false })
  service.registerLate({ firstName: 'Liisa', lastName: 'Lapsi', gender: 'M', birthDate: '2016-01-01', raceId: 'R1', bib: 2, consent: false })
  const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
  const auth = { authorization: `Bearer ${session.json().token as string}` }
  const adult = db.get<{ id: string }>('SELECT id FROM person WHERE last_name = ?', 'Aiku')!.id
  const child = db.get<{ id: string }>('SELECT id FROM person WHERE last_name = ?', 'Lapsi')!.id
  return { db, app, service, auth, adult, child }
}

function rows(db: { all: <T>(sql: string, ...params: unknown[]) => T[] }, personId: string) {
  return db.all<{ id: string; granted: number; given_by: string; guardian_name: string | null; recorded_by: string | null; evidence_json: string | null }>(
    'SELECT id, granted, given_by, guardian_name, recorded_by, evidence_json FROM consent WHERE person_id = ? ORDER BY recorded_at, id',
    personId,
  )
}

describe('consent route', () => {
  it('validates the body, stores a guardian, and rejects an unknown person', async () => {
    const { db, app, auth, child } = await fixture()
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/persons/missing/consents',
      headers: auth,
      payload: { granted: true, givenBy: 'self', channel: 'office' },
    })
    expect(missing.statusCode).toBe(404)

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${child}/consents`,
      headers: auth,
      payload: { granted: 'yes', channel: 'office' },
    })
    expect(invalid.statusCode).toBe(422)

    const self = await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${child}/consents`,
      headers: auth,
      payload: { granted: true, givenBy: 'self', channel: 'office' },
    })
    expect(self.statusCode).toBe(422)
    expect(self.json().error.message).toMatch(/under 15/)

    const incomplete = await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${child}/consents`,
      headers: auth,
      payload: { granted: true, givenBy: 'guardian', channel: 'office', guardian: { name: 'Ada', relation: 'parent', contact: '' } },
    })
    expect(incomplete.statusCode).toBe(422)

    const saved = await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${child}/consents`,
      headers: auth,
      payload: {
        granted: true,
        givenBy: 'guardian',
        channel: 'office',
        recordedBy: 'clerk-1',
        guardian: { name: 'Ada Parent', relation: 'parent', contact: 'ada@example.com' },
      },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().id).toMatch(ULID)
    const stored = rows(db, child).at(-1)
    expect(stored).toMatchObject({
      granted: 1,
      given_by: 'guardian',
      guardian_name: 'Ada Parent',
      recorded_by: 'clerk-1',
    })
    expect(JSON.parse(stored?.evidence_json ?? '{}')).toEqual({ relation: 'parent', contact: 'ada@example.com' })
    db.raw.close()
    await app.close()
  })

  it('appends a revocation, keeps the earlier row, and records an audit', async () => {
    const { db, app, service, auth, adult } = await fixture()
    service.clock.set(Date.parse('2027-06-12T12:00:00Z'))
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${adult}/consents`,
      headers: auth,
      payload: { granted: true, givenBy: 'self', channel: 'office' },
    })
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/persons/${adult}/consents`,
      headers: auth,
      payload: { granted: false, givenBy: 'self', channel: 'office' },
    })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.json().id).toMatch(ULID)
    expect(second.json().id).toMatch(ULID)
    expect(first.json().id).not.toBe(second.json().id)
    const consent = rows(db, adult)
    expect(consent.map((row) => row.granted)).toEqual([0, 1, 0])
    expect(consent[1]?.id).toBe(first.json().id)
    expect(consent[2]?.recorded_by).toBe('DEV_LAPTOP_1')
    expect(db.get('SELECT id FROM person WHERE id = ?', adult)).toBeUndefined()
    const audit = service.audit().filter((row) => row.action === 'record_consent')
    expect(audit.map((row) => row.reason)).toEqual(['consent granted', 'consent revoked'])
    db.raw.close()
    await app.close()
  })
})
