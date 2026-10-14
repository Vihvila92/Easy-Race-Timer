import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { Clock, RaceService } from './service.js'

describe('finish load', () => {
  it('keeps 300 taps from 500 entrants under 50 ms at p95', () => {
    const db = openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent({
      id: 'EV_LOAD',
      name: 'Load',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      races: [{ id: 'R1', name: { fi: '5 km', en: '5 km' }, distance_m: 5000, start_mode: 'mass' }],
      categories: [{
        id: 'M', race_id: 'R1', gender: 'M', min_age: 16, max_age: null, ranked: true,
        name: { fi: 'M', en: 'M' }, description: { fi: 'Miehet', en: 'Men' },
      }],
    })
    for (let index = 0; index < 500; index += 1) {
      service.registerLate({
        firstName: `Runner${index}`,
        lastName: 'Load',
        gender: 'M',
        birthDate: '1990-01-01',
        raceId: 'R1',
        bib: index + 1,
        consent: false,
      })
    }
    const start = Date.parse('2027-06-12T11:00:00+03:00')
    service.startRace('R1', start)
    const durations: number[] = []
    for (let index = 0; index < 300; index += 1) {
      const began = performance.now()
      service.recordFinish({
        id: `L${String(index).padStart(3, '0')}`,
        timeMs: start + 60_000 + index,
        bib: (index % 500) + 1,
      })
      durations.push(performance.now() - began)
    }
    durations.sort((left, right) => left - right)
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0
    const finishes = service.timingEvents().filter((event) => event.id.startsWith('L'))
    expect(finishes).toHaveLength(300)
    expect(p95).toBeLessThan(50)
  })
})
