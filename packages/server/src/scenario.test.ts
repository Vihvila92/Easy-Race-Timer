import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsv, RESULT_FIELDS } from '@ert/core'
import { openDatabase } from '@ert/storage'
import { Clock, RaceService } from './service.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const dir = path.join(root, 'testdata/kuulan-holkka')

function read(name: string) {
  return readFileSync(path.join(dir, name), 'utf8')
}

function project(csv: string) {
  return parseCsv(csv).map((row) => RESULT_FIELDS.map((field) => row[field] ?? '').join(';'))
}

describe('Kuulan hölkkä oracle', () => {
  it('replays race day and matches every expected file', () => {
    const db = openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent(JSON.parse(read('event.json')))
    service.importClubs(JSON.parse(read('clubs-registry.json')).clubs)
    const preview = service.previewCsv(read('entries.csv'))
    expect(preview.count).toBe(67)
    expect(preview.errors).toBe(0)
    const expectedCategories = parseCsv(read('expected-categories.csv'))
    for (const row of preview.rows) {
      const expected = expectedCategories.find((item) => item.numero === String(row.bib))
      expect(expected, String(row.bib)).toBeTruthy()
      expect(row.birth_date.categoryId).toBe(expected?.birth_date_sarja)
      expect(row.birth_date.warnings).toBe(expected?.birth_date_varoitukset)
      expect(String(row.birth_date.age)).toBe(expected?.birth_date_ika)
      expect(row.birth_year.categoryId).toBe(expected?.birth_year_sarja)
      expect(row.birth_year.warnings).toBe(expected?.birth_year_varoitukset)
    }
    const expectedClubs = parseCsv(read('expected-clubs.csv'))
    for (const club of expectedClubs) {
      const match = preview.clubs.find((item) => item.name === club.seura && item.abbreviation === club.seuran_lyhenne)
      expect(match?.type, club.seura).toBe(club.tunnistus)
    }
    const imported = service.importCsv(read('entries.csv'))
    expect(imported.count).toBe(67)
    expect(service.consents()).toHaveLength(67)

    const switched = service.setAgeBasis('birth_year', false)
    const row123 = switched.find((item) => item?.bib === 123)
    const row135 = switched.find((item) => item?.bib === 135)
    expect(row123?.categoryId).toBe('P8')
    expect(row135?.categoryId).toBe('')
    service.setAgeBasis('birth_date', false)

    const raceDay = JSON.parse(read('race-day.json')) as { actions: Record<string, unknown>[] }
    for (const action of raceDay.actions) service.perform(action)

    expect(project(service.resultsCsv('public'))).toEqual(project(read('expected-results.csv')))
    service.setOffsetPolicy('unranked')
    expect(project(service.resultsCsv('public'))).toEqual(project(read('expected-results.offset-unranked.csv')))
    service.setOffsetPolicy('open_category')
    expect(project(service.resultsCsv('public'))).toEqual(project(read('expected-results.offset-open-category.csv')))
    service.setOffsetPolicy('ranked')

    const audit = service.audit()
    const reasons = audit.map((row) => row.reason)
    for (const action of raceDay.actions) {
      if (typeof action.reason === 'string' && action.type !== 'change_race_rejected') {
        expect(reasons, String(action.type)).toContain(action.reason)
      }
    }
    expect(audit.filter((row) => row.action === 'confirm_tie')).toHaveLength(3)
    expect(audit.filter((row) => row.action === 'lock')).toHaveLength(2)

    const stats = service.clubStatistics()
    const expectedStats = parseCsv(read('expected-club-stats.csv'))
    expect(stats.map((row) => [row.race, row.club_abbr, row.entrants, row.finishers, row.published_as].join(';')))
      .toEqual(expectedStats.map((row) => [row.race, row.club_abbr, row.entrants, row.finishers, row.published_as].join(';')))

    const retention = service.runRetention(Date.parse('2028-06-13T12:00:00+03:00'))
    expect(retention.anonymized).toBeGreaterThan(0)
    expect(project(service.resultsCsv('public'))).toEqual(project(read('expected-results.anonymized.csv')))
    const after = service.clubStatistics()
    expect(after.map((row) => [row.race, row.club_abbr, row.entrants, row.finishers].join(';')))
      .toEqual(stats.map((row) => [row.race, row.club_abbr, row.entrants, row.finishers].join(';')))

    const dump = JSON.stringify(db.snapshot())
    const entries = parseCsv(read('entries.csv'))
    for (const row of entries) {
      if (row.pitkaaikainen_tallennus === 'kyllä') continue
      expect(dump).not.toContain(row.sahkoposti || '___no_email___')
      if (row.syntymaaika) expect(dump).not.toContain(row.syntymaaika)
      expect(dump).not.toContain(`${row.sukunimi} ${row.etunimi}`)
    }
  })

  it('undoes a club merge and puts the moved entries back', () => {
    const db = openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent(JSON.parse(read('event.json')))
    service.importClubs(JSON.parse(read('clubs-registry.json')).clubs)
    service.importCsv(read('entries.csv'))
    const before = service.listClubs().find((club) => club.id === 'CL_UU_DUP')
    expect(before?.entries).toBe(2)
    expect(service.mergeClubs('CL_UU_DUP', 'CL_UU', true, 'Kaksoiskappale').moved).toBe(2)
    expect(service.listClubs().find((club) => club.id === 'CL_UU_DUP')?.entries).toBe(0)
    expect(service.undoMerge('CL_UU_DUP', 'Peru yhdistäminen').restored).toBe(2)
    const after = service.listClubs().find((club) => club.id === 'CL_UU_DUP')
    expect(after?.status).toBe('active')
    expect(after?.entries).toBe(2)
  })
})
