import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp, DEFAULT_GLOBAL_MAX, DEFAULT_RECORDING_MAX, DEFAULT_STRICT_MAX } from './app.js'

describe('rate limits', () => {
  it('defaults to 300 per minute, 5 on sensitive routes, and a generous finish burst', () => {
    expect(DEFAULT_GLOBAL_MAX).toBe(300)
    expect(DEFAULT_STRICT_MAX).toBe(5)
    expect(DEFAULT_RECORDING_MAX).toBeGreaterThanOrEqual(6_000)
  })

  it('refuses the next sensitive call and still accepts a finish burst above the global cap', async () => {
    const db = await openDatabase(':memory:')
    const { app, service } = await createApp({
      db,
      testMode: true,
      rateLimit: { globalMax: 4, strictMax: 2, recordingMax: 8 },
    })
    service.importEvent({
      id: 'EV',
      name: 'Limit',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000 }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
    })
    service.registerLate({ firstName: 'A', lastName: 'B', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 1, consent: false })
    const start = Date.parse('2027-06-12T10:00:00Z')
    service.startRace('R1', start)
    const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    expect(session.statusCode).toBe(200)
    const second = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    expect(second.statusCode).toBe(200)
    const blockedPin = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    expect(blockedPin.statusCode).toBe(429)

    const headers = { authorization: `Bearer ${session.json().token as string}` }
    for (let i = 0; i < 2; i += 1) {
      const imported = await app.inject({ method: 'POST', url: '/api/v1/events/import', headers, payload: {} })
      expect(imported.statusCode).not.toBe(429)
    }
    const blockedImport = await app.inject({ method: 'POST', url: '/api/v1/events/import', headers, payload: {} })
    expect(blockedImport.statusCode).toBe(429)

    for (let i = 0; i < 2; i += 1) {
      const retention = await app.inject({ method: 'POST', url: '/api/v1/retention/run', headers, payload: {} })
      expect(retention.statusCode).not.toBe(429)
    }
    const blockedRetention = await app.inject({ method: 'POST', url: '/api/v1/retention/run', headers, payload: {} })
    expect(blockedRetention.statusCode).toBe(429)

    for (let i = 0; i < 6; i += 1) {
      const saved = await app.inject({
        method: 'POST',
        url: '/api/v1/timing-events',
        headers,
        payload: { timeMs: start + 1_000 + i, bib: 1, mode: 'time_first' },
      })
      expect(saved.statusCode, `finish ${i}`).toBe(200)
    }

    for (let i = 0; i < 4; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200)
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(429)

    db.raw.close()
    await app.close()
  })
})
