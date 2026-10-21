// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsv } from '@ert/core'
import { findDuplicatePairs, recognizeClubs, searchClubs, type ClubRef } from './clubs.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const dir = path.join(root, 'testdata/kuulan-holkka')

describe('club recognition', () => {
  const registryFile = JSON.parse(readFileSync(path.join(dir, 'clubs-registry.json'), 'utf8')) as { clubs: ClubRef[] }
  const registry = registryFile.clubs.map((club) => ({ ...club, status: 'active' as const, aliases: [] }))
  const entries = parseCsv(readFileSync(path.join(dir, 'entries.csv'), 'utf8'))
  const expected = parseCsv(readFileSync(path.join(dir, 'expected-clubs.csv'), 'utf8'))

  it('classifies every CSV club value the way the oracle does', () => {
    const recognized = recognizeClubs(entries.map((row) => ({ name: row.seura, abbreviation: row.seuran_lyhenne })), registry)
    for (const row of expected) {
      const match = recognized.matches.find((item) => item.name === row.seura && item.abbreviation === row.seuran_lyhenne)
      expect(match, `${row.seura}/${row.seuran_lyhenne}`).toBeTruthy()
      expect(match?.type).toBe(row.tunnistus)
      expect(match?.clubId).toBe(row.tuonnissa)
      expect(String(match?.rows)).toBe(row.riveja)
    }
  })

  it('suggests merging the Uuraisten Urh. duplicate into UU', () => {
    const pairs = findDuplicatePairs(registry)
    expect(pairs).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'CL_UU_DUP', targetId: 'CL_UU' })]))
  })

  it('searches by abbreviation and by the start of a name', () => {
    expect(searchClubs(registry, 'UU')[0]?.id).toBe('CL_UU')
    expect(searchClubs(registry, 'muur')[0]?.id).toBe('CL_MUYR')
  })
})
