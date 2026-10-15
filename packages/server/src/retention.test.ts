import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { Clock, RaceService } from './service.js'

const PAST = '2028-06-13T12:00:00+03:00'
const EARLY = '2027-06-13T12:00:00+03:00'

async function fixture(testMode: boolean) {
  const db = await openDatabase(':memory:')
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
    firstName: 'Aino', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false,
  })
  const calls: string[] = []
  const { app } = createApp({
    db,
    testMode,
    backup: async (reason) => {
      const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM person')?.n ?? -1
      calls.push(`${reason}:${n}`)
    },
  })
  const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
  const auth = { authorization: `Bearer ${session.json().token as string}` }
  return { db, service, app, auth, calls }
}

function people(db: { get: <T>(sql: string) => T | undefined }) {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM person')?.n ?? -1
}

describe('retention run', () => {
  it('does not anonymize when production is given at:2099', async () => {
    const { db, app, auth } = await fixture(false)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/retention/run',
      headers: auth,
      payload: { at: '2099-01-01', confirm: true },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
    expect(people(db)).toBe(1)
    db.raw.close()
    await app.close()
  })

  it('previews, then requires a lock, a passed deadline and a backup', async () => {
    const { db, service, app, auth, calls } = await fixture(true)
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/retention/run',
      headers: auth,
      payload: { at: PAST },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ preview: true, anonymized: 0, eligible: 1, locked: false, deadline_passed: true })
    expect(people(db)).toBe(1)

    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/v1/retention/run',
      headers: auth,
      payload: { at: PAST, confirm: true },
    })
    expect(unlocked.statusCode).toBe(409)
    expect(unlocked.json().error.code).toBe('LOCK_BLOCKED')
    expect(people(db)).toBe(1)
    expect(calls).toEqual([])

    service.setStatus(1, 'dns', 'test')
    service.lockRace('R1')
    const early = await app.inject({
      method: 'POST',
      url: '/api/v1/retention/run',
      headers: auth,
      payload: { at: EARLY, confirm: true },
    })
    expect(early.statusCode).toBe(422)
    expect(early.json().error.message).toMatch(/deadline/)
    expect(people(db)).toBe(1)

    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/retention/run',
      headers: auth,
      payload: { at: PAST, confirm: true },
    })
    expect(done.statusCode).toBe(200)
    expect(done.json().anonymized).toBe(1)
    expect(calls).toEqual(['retention:1'])
    expect(people(db)).toBe(0)
    expect(service.audit().some((row) => row.action === 'retention' && row.reason === 'retention run')).toBe(true)
    db.raw.close()
    await app.close()
  })

  it('keeps people when the backup fails', async () => {
    const db = await openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent({
      id: 'EV', name: 'Retention', date: '2027-06-12', timezone: 'Europe/Helsinki', sport: 'run',
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000 }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 16 }],
    })
    service.registerLate({ firstName: 'Aino', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false })
    service.setStatus(1, 'dns', 'test')
    service.lockRace('R1')
    const { app } = createApp({
      db,
      testMode: true,
      backup: async () => { throw new Error('disk full') },
    })
    const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/retention/run',
      headers: { authorization: `Bearer ${session.json().token as string}` },
      payload: { at: PAST, confirm: true },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json().error.code).toBe('BACKUP_FAILED')
    expect(people(db)).toBe(1)
    db.raw.close()
    await app.close()
  })
})
