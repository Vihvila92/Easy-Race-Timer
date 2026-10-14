import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { computeResults, type ComputeEntrant } from './results.js'

function entrant(partial: Partial<ComputeEntrant> & Pick<ComputeEntrant, 'entryId' | 'timeMs' | 'bib'>): ComputeEntrant {
  return {
    raceId: 'R',
    categoryId: 'C',
    name: partial.entryId,
    clubAbbr: '',
    clubName: '',
    status: 'OK',
    ranked: true,
    note: '',
    tieIndex: 0,
    orderKey: partial.bib ?? 0,
    ...partial,
  }
}

describe('computeResults', () => {
  it('gives a shared place and skips the next one', () => {
    const rows = computeResults({
      raceIds: ['R'],
      categoryIdsByRace: { R: ['C'] },
      entrants: [
        entrant({ entryId: 'a', bib: 1, timeMs: 10_100, tieIndex: 0 }),
        entrant({ entryId: 'b', bib: 2, timeMs: 10_800, tieIndex: 0 }),
        entrant({ entryId: 'c', bib: 3, timeMs: 12_000, tieIndex: 0 }),
      ],
    }).filter((row) => row.scope === 'overall')
    expect(rows.map((row) => row.rank)).toEqual(['1', '1', '3'])
  })

  it('keeps rank order when the input list is shuffled', () => {
    fc.assert(fc.property(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 }), (order) => {
      const times = [1000, 2500, 2500, 4000, 9000]
      const people = order.map((index) => entrant({
        entryId: `e${index}`,
        bib: index + 1,
        timeMs: times[index],
        tieIndex: index === 2 ? 1 : 0,
      }))
      const ranks = computeResults({
        raceIds: ['R'],
        categoryIdsByRace: { R: [] },
        entrants: people,
      }).filter((row) => row.scope === 'overall').map((row) => `${row.bib}:${row.rank}`)
      expect(ranks).toEqual(['1:1', '2:2', '3:3', '4:4', '5:5'])
    }))
  })
})
