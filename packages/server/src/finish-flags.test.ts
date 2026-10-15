import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { Clock, RaceService } from './service.js'

describe('finish review flags', () => {
  it('keeps a duplicate and an unknown bib and marks both for review', async () => {
    const db = await openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent({
      id: 'EV',
      name: 'Finish',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
    })
    service.registerLate({ firstName: 'A', lastName: 'B', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 105, consent: false })
    const start = Date.parse('2027-06-12T10:00:00Z')
    service.startRace('R1', start)
    const first = service.recordFinish({ id: 'F001', timeMs: start + 1000, bib: 105 })
    const duplicate = service.recordFinish({ id: 'F002', timeMs: start + 2000, bib: 105 })
    const unknown = service.recordFinish({ id: 'F003', timeMs: start + 3000, bib: 9999 })
    expect(first.flags).toEqual([])
    expect(duplicate.flags).toEqual(['duplicate'])
    expect(unknown.flags).toEqual(['unknown_bib'])
    const review = service.timingEvents().filter((event) => event.flags.includes('duplicate') || event.flags.includes('unknown_bib'))
    expect(review.map((event) => event.id)).toEqual(['F002', 'F003'])
    db.raw.close()
  })
})

describe('finish review route', () => {
  it('returns the flags from the timing endpoint', async () => {
    const db = await openDatabase(':memory:')
    const { app, service } = createApp({ db, testMode: true })
    service.importEvent({
      id: 'EV', name: 'Finish', date: '2027-06-12', timezone: 'Europe/Helsinki', sport: 'run',
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000 }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
    })
    service.registerLate({ firstName: 'A', lastName: 'B', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 105, consent: false })
    const start = Date.parse('2027-06-12T10:00:00Z')
    service.startRace('R1', start)
    const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const headers = { authorization: `Bearer ${session.json().token as string}` }
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-events',
      headers,
      payload: { id: 'F010', timeMs: start + 1000, bib: 9999, mode: 'bib_first' },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().flags).toEqual(['unknown_bib'])
    const listed = await app.inject({ method: 'GET', url: '/api/v1/timing-events', headers })
    expect(listed.json().some((event: { id: string; flags: string[] }) => event.id === 'F010' && event.flags.includes('unknown_bib'))).toBe(true)
    db.raw.close()
    await app.close()
  })
})
