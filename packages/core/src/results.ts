// SPDX-License-Identifier: AGPL-3.0-only
import { formatDuration } from './time.js'

export type ResultStatus = 'OK' | 'DNS' | 'DNF' | 'DSQ'

export interface ComputeEntrant {
  entryId: string
  raceId: string
  categoryId: string
  bib: number | null
  name: string
  clubAbbr: string
  clubName: string
  status: ResultStatus
  timeMs: number | null
  ranked: boolean
  note: string
  /** 0 when the tie is unconfirmed or this finisher is alone in the group. */
  tieIndex: number
  /** Bib while known; frozen dense rank after anonymization so order survives bib removal. */
  orderKey: number
}

export interface ResultRow {
  entryId: string
  race: string
  scope: string
  rank: string
  bib: string
  name: string
  club_abbr: string
  club_name: string
  category: string
  time: string
  time_ms: string
  behind: string
  status: string
  note: string
}

export const RESULT_FIELDS = [
  'race', 'scope', 'rank', 'bib', 'name', 'club_abbr', 'club_name', 'category', 'time', 'time_ms', 'behind', 'status', 'note',
] as const

function compareOk(a: ComputeEntrant, b: ComputeEntrant): number {
  const aSec = Math.floor((a.timeMs ?? 0) / 1000)
  const bSec = Math.floor((b.timeMs ?? 0) / 1000)
  return aSec - bSec
    || a.tieIndex - b.tieIndex
    || (a.timeMs ?? 0) - (b.timeMs ?? 0)
    || a.orderKey - b.orderKey
}

function rowBase(entrant: ComputeEntrant, scope: string, rank: string, time: string, timeMs: string, behind: string): ResultRow {
  return {
    entryId: entrant.entryId,
    race: entrant.raceId,
    scope,
    rank,
    bib: entrant.bib == null ? '' : String(entrant.bib),
    name: entrant.name,
    club_abbr: entrant.clubAbbr,
    club_name: entrant.clubName,
    category: entrant.categoryId,
    time,
    time_ms: timeMs,
    behind,
    status: entrant.status,
    note: entrant.note,
  }
}

/**
 * Rank finishers from timing data.
 * Display time is floored to 1s. Confirmed tie index orders runners who share a display time.
 * Equal tie keys share a place and the next place skips.
 */
export function computeResults(input: {
  raceIds: string[]
  categoryIdsByRace: Record<string, string[]>
  entrants: ComputeEntrant[]
}): ResultRow[] {
  const rows: ResultRow[] = []
  for (const raceId of input.raceIds) {
    const entrants = input.entrants.filter((entrant) => entrant.raceId === raceId)
    const scopes = ['overall', ...(input.categoryIdsByRace[raceId] ?? [])]
    for (const scope of scopes) {
      const group = entrants.filter((entrant) => scope === 'overall' || entrant.categoryId === scope)
      if (!group.length) continue
      const ranked = group
        .filter((entrant) => entrant.status === 'OK' && entrant.ranked && entrant.timeMs != null)
        .sort(compareOk)
      const unranked = group
        .filter((entrant) => entrant.status === 'OK' && !entrant.ranked && entrant.timeMs != null)
        .sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0) || a.orderKey - b.orderKey)
      const incomplete = group
        .filter((entrant) => entrant.status !== 'OK')
        .sort((a, b) => a.status.localeCompare(b.status) || a.orderKey - b.orderKey)

      let previousKey: string | null = null
      let previousRank = 0
      const lead = ranked[0]?.timeMs ?? 0
      ranked.forEach((entrant, index) => {
        const place = index + 1
        const key = `${Math.floor((entrant.timeMs ?? 0) / 1000)}:${entrant.tieIndex}`
        const rank = key === previousKey ? previousRank : place
        previousKey = key
        previousRank = rank
        const behind = place === 1
          ? ''
          : `+${formatDuration((Math.floor((entrant.timeMs ?? 0) / 1000) - Math.floor(lead / 1000)) * 1000)}`
        rows.push(rowBase(
          entrant,
          scope,
          String(rank),
          formatDuration(entrant.timeMs ?? 0),
          String(entrant.timeMs ?? ''),
          behind,
        ))
      })
      for (const entrant of unranked) {
        rows.push(rowBase(
          entrant,
          scope,
          '',
          formatDuration(entrant.timeMs ?? 0),
          String(entrant.timeMs ?? ''),
          '',
        ))
      }
      for (const entrant of incomplete) {
        rows.push(rowBase(entrant, scope, '', '', '', ''))
      }
    }
  }
  return rows
}

export function resultProjection(row: ResultRow): Record<string, string> {
  const projection: Record<string, string> = {}
  for (const field of RESULT_FIELDS) projection[field] = row[field]
  return projection
}
