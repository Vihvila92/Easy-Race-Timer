// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.js'
import { suggestCategory, type CategoryDef, type CategoryWarning } from './category.js'

function warningText(warnings: CategoryWarning[]): string {
  return warnings.map((warning) => {
    if (warning.code === 'birth_year_only') return 'vain syntymävuosi -> vuosi-ikä'
    if (warning.code === 'below_youngest') return `ikä ${warning.age} alle nuorimman sarjan, sijoitettu ${warning.categoryId}`
    if (warning.code === 'no_matching_category') {
      return `NO_MATCHING_CATEGORY: ikään sopiva sarja ${warning.categoryId} on matkalla ${warning.categoryRaceId}, ilmoittautunut ${warning.enteredRaceId}`
    }
    return 'NO_MATCHING_CATEGORY: ei sopivaa sarjaa'
  }).join(' | ')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const dir = path.join(root, 'testdata/kuulan-holkka')

describe('Kuulan hölkkä categories', () => {
  const event = JSON.parse(readFileSync(path.join(dir, 'event.json'), 'utf8'))
  const categories: CategoryDef[] = event.categories.map((category: { id: string; race_id: string; gender: 'F' | 'M' | null; min_age: number | null; max_age: number | null; ranked?: boolean; auto_assign?: boolean }) => ({
    id: category.id,
    raceId: category.race_id,
    gender: category.gender,
    minAge: category.min_age,
    maxAge: category.max_age,
    ranked: category.ranked !== false,
    autoAssign: category.auto_assign !== false,
  }))
  const entries = parseCsv(readFileSync(path.join(dir, 'entries.csv'), 'utf8'))
  const expected = parseCsv(readFileSync(path.join(dir, 'expected-categories.csv'), 'utf8'))
  const genderByBib = new Map(entries.map((row) => [row.numero, row.sukupuoli === 'N' ? 'F' : 'M'] as const))

  it('matches both age bases for the imported field', () => {
    for (const row of expected) {
      const gender = genderByBib.get(row.numero)
      if (!gender) continue
      for (const basis of ['birth_date', 'birth_year'] as const) {
        const suggestion = suggestCategory({
          gender,
          birthDate: row.syntymaaika || null,
          birthYear: row.syntymavuosi ? Number(row.syntymavuosi) : null,
        }, basis, row.matka, categories, event.date)
        expect(suggestion.categoryId, `${row.numero} ${basis}`).toBe(row[`${basis}_sarja`])
        expect(String(suggestion.age), `${row.numero} ${basis} age`).toBe(row[`${basis}_ika`])
        expect(warningText(suggestion.warnings), `${row.numero} ${basis} warnings`).toBe(row[`${basis}_varoitukset`])
      }
    }
  })
})
