// SPDX-License-Identifier: AGPL-3.0-only
import { RaceService } from './service.js'

/** Shared race used by retention and restore tests. One person, no long-term consent. */
export function seedRetentionRace(service: RaceService): void {
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
}
