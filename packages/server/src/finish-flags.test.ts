import { describe, expect, it } from 'vitest'
import { createId } from '@ert/core'
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

    const id = `${createId()}:${createId()}`
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-events',
      headers,
      payload: { id, deviceId: 'tab-a', timeMs: start + 4000, bib: 105, mode: 'time_first', label: 'F011' },
    })
    expect(first.statusCode).toBe(200)
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-events',
      headers,
      payload: { id, deviceId: 'tab-a', timeMs: start + 4000, bib: 105, mode: 'time_first', label: 'F011' },
    })
    expect(replay.statusCode).toBe(200)
    const clash = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-events',
      headers,
      payload: { id, deviceId: 'tab-a', timeMs: start + 5000, bib: 105, mode: 'time_first', label: 'F011' },
    })
    expect(clash.statusCode).toBe(409)
    expect(clash.json().error.code).toBe('SYNC_CONFLICT')
    const other = `${createId()}:${createId()}`
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/timing-events',
      headers,
      payload: { id: other, deviceId: 'tab-b', timeMs: start + 6000, bib: 105, mode: 'time_first', label: 'F001' },
    })
    expect(second.statusCode).toBe(200)
    const events = (await app.inject({ method: 'GET', url: '/api/v1/timing-events', headers })).json() as { id: string; time_ms: number }[]
    expect(events.filter((event) => event.id === id)).toEqual([expect.objectContaining({ time_ms: start + 4000 })])
    expect(events.some((event) => event.id === other)).toBe(true)
    db.raw.close()
    await app.close()
  })
})

describe('finish before the runner start', () => {
  it('flags the tap, leaves it out of the ranking, and ranks it once a later time exists', async () => {
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
    service.registerLate({ firstName: 'A', lastName: 'Early', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false })
    service.registerLate({ firstName: 'B', lastName: 'Later', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 2, consent: false })
    service.setStartOffset(1, 60_000, 'tasoitus')
    const start = Date.parse('2027-06-12T10:00:00Z')
    service.startRace('R1', start)
    const early = service.recordFinish({ id: createId(), timeMs: start + 1_000, bib: 1 })
    expect(early.flags).toContain('before_start')
    service.recordFinish({ id: createId(), timeMs: start + 10_000, bib: 2 })
    const before = service.results('public').filter((row) => row.scope === 'overall')
    expect(before.find((row) => row.bib === '1')).toBeUndefined()
    expect(before.find((row) => row.bib === '2')?.rank).toBe('1')
    expect(before.some((row) => row.time_ms.startsWith('-'))).toBe(false)
    expect(service.lockBlockers('R1').some((blocker) => blocker.endsWith(':before_start'))).toBe(true)

    const valid = service.recordFinish({ id: createId(), timeMs: start + 70_000, bib: 1 })
    expect(valid.flags).not.toContain('before_start')
    const after = service.results('public').filter((row) => row.scope === 'overall' && row.bib === '1')
    expect(after[0]?.rank).not.toBe('')
    expect(Number(after[0]?.time_ms)).toBeGreaterThanOrEqual(0)
    service.voidTap(early.id, 'väärä aika')
    expect(service.lockBlockers('R1').some((blocker) => blocker.endsWith(':before_start'))).toBe(false)
    db.raw.close()
  })
})
