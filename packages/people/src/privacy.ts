// SPDX-License-Identifier: AGPL-3.0-only
import { ageOnReference, type AgeBasis, type AgeInput, type ResultRow } from '@ert/core'

export interface PrivacyEntrant {
  entryId: string
  raceId: string
  categoryId: string
  clubId: string | null
  clubAbbr: string
  anonymized: boolean
}

export interface ClubStatEntrant {
  raceId: string
  clubId: string | null
  clubAbbr: string
  clubName: string
  finished: boolean
}

export interface ClubStatRow {
  race: string
  club_abbr: string
  club_name: string
  entrants: string
  finishers: string
  published_as: string
}

function generalize(categoryId: string): string {
  return categoryId.replace(/\d+$/, '') || categoryId
}

/**
 * Public result list after the retention job.
 * Small category×club groups drop the club. Small categories generalize the code
 * and hide the time on that category's own list.
 */
export function applyPublicPrivacy(rows: ResultRow[], entrants: PrivacyEntrant[], k = 3, locale: 'fi' | 'en' = 'fi'): ResultRow[] {
  const anonymous = locale === 'en' ? 'Anonymous' : 'Anonyymi'
  const clubHidden = locale === 'en' ? 'club hidden (small group)' : 'seura piilotettu (pieni ryhmä)'
  const categoryGeneral = locale === 'en' ? 'category generalized (small category)' : 'sarja yleistetty (pieni sarja)'
  const timeHidden = locale === 'en' ? 'time hidden (small category)' : 'aika piilotettu (pieni sarja)'
  const anonymizedLabel = locale === 'en' ? 'anonymized' : 'anonymisoitu'
  const offsetKept = locale === 'en' ? 'Handicap start' : 'Siirretty lähtö'
  const byId = new Map(entrants.map((entrant) => [entrant.entryId, entrant]))

  return rows.map((row) => {
    const entrant = byId.get(row.entryId)
    if (!entrant?.anonymized) return row
    const sameClub = entrants.filter((other) =>
      other.raceId === entrant.raceId
      && other.categoryId === entrant.categoryId
      && entrant.clubId
      && other.clubId === entrant.clubId)
    const showClub = Boolean(entrant.clubId) && sameClub.length >= k
    const categorySize = entrants.filter((other) => other.raceId === entrant.raceId && other.categoryId === entrant.categoryId).length
    const next: ResultRow = { ...row }
    next.name = showClub && row.club_abbr ? `${anonymous} (${row.club_abbr})` : anonymous
    next.bib = ''
    const notes = [anonymizedLabel]
    if (entrant.clubId && !showClub) {
      next.club_abbr = ''
      next.club_name = ''
      notes.push(clubHidden)
    }
    if (categorySize < k) {
      next.category = generalize(entrant.categoryId)
      notes.push(categoryGeneral)
      if (row.scope !== 'overall') {
        next.time = ''
        next.time_ms = ''
        next.behind = ''
        notes.push(timeHidden)
      }
    }
    const kept = row.note.includes('Siirretty lähtö') || row.note.includes('Handicap start') ? [offsetKept] : []
    next.note = [...kept, ...notes].join('; ')
    return next
  })
}

export function clubStats(entrants: ClubStatEntrant[], k = 3, locale: 'fi' | 'en' = 'fi'): ClubStatRow[] {
  const none = locale === 'en' ? '(no club)' : '(ei seuraa)'
  const others = locale === 'en' ? 'Other clubs' : 'Muut seurat'
  const groupWord = locale === 'en' ? 'groups' : 'ryhmää'
  const rows: ClubStatRow[] = []
  const races = [...new Set(entrants.map((entrant) => entrant.raceId))]
  for (const raceId of races) {
    const inRace = entrants.filter((entrant) => entrant.raceId === raceId)
    const groups = new Map<string, ClubStatEntrant[]>()
    for (const entrant of inRace) {
      const key = entrant.clubId ?? '-'
      groups.set(key, [...(groups.get(key) ?? []), entrant])
    }
    const sizes = [...groups.entries()].sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1))
    const small = new Set([...groups.entries()].filter(([, list]) => list.length < k).map(([id]) => id))
    if (small.size === 1) {
      const next = sizes.find(([id]) => !small.has(id))
      if (next) small.add(next[0])
    }
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    for (const [clubId, list] of ordered) {
      const sample = list[0]
      const abbr = sample.clubId ? (sample.clubAbbr || sample.clubName) : none
      const name = sample.clubId ? sample.clubName : ''
      const finishers = list.filter((entrant) => entrant.finished).length
      rows.push({
        race: raceId,
        club_abbr: abbr,
        club_name: name,
        entrants: String(list.length),
        finishers: String(finishers),
        published_as: small.has(clubId) ? others : abbr,
      })
    }
    const hidden = inRace.filter((entrant) => small.has(entrant.clubId ?? '-'))
    rows.push({
      race: raceId,
      club_abbr: others,
      club_name: `${small.size} ${groupWord}`,
      entrants: String(hidden.length),
      finishers: String(hidden.filter((entrant) => entrant.finished).length),
      published_as: others,
    })
  }
  return rows
}

export const PUBLICATION_LEVELS = ['full', 'initials', 'bib_only', 'hidden'] as const
export type PublicationLevel = (typeof PUBLICATION_LEVELS)[number]

export function isPublicationLevel(value: string | undefined | null): value is PublicationLevel {
  return PUBLICATION_LEVELS.includes(value as PublicationLevel)
}

/** Under 15, and when age is unknown, the public default is initials. */
export function defaultPublication(person: AgeInput, referenceDate: string, basis: AgeBasis = 'birth_date'): PublicationLevel {
  try {
    const { age } = ageOnReference(person, basis, referenceDate)
    return age < 15 ? 'initials' : 'full'
  } catch {
    return 'initials'
  }
}

/**
 * Given-name initials, then the surname initial. "Hämäläinen Lotta" becomes "L. H."
 * The surname itself is never published. Hidden and bib-only publish no name.
 */
export function publishedName(displayName: string, level: PublicationLevel): string {
  if (level === 'hidden' || level === 'bib_only') return ''
  if (level === 'full') return displayName
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return `${parts[0]!.charAt(0)}.`
  const surname = parts[0]!
  const given = parts.slice(1).map((part) => `${part.charAt(0)}.`)
  return `${given.join(' ')} ${surname.charAt(0)}.`
}

export function applyPublication(rows: ResultRow[], levels: ReadonlyMap<string, PublicationLevel>): ResultRow[] {
  return rows.map((row) => {
    const level = levels.get(row.entryId) ?? 'full'
    if (level === 'full') return row
    return { ...row, name: publishedName(row.name, level) }
  })
}

export const CONSENT_TEXT_VERSION = 'retention-v1'

export function consentCopy(months: number, locale: 'fi' | 'en'): { no: string; yes: string } {
  if (locale === 'en') {
    return {
      no: `Your name, date of birth and contact details are removed after ${months} months. Your result, category and club stay in the statistics without your name.`,
      yes: 'The details are kept until you withdraw permission.',
    }
  }
  return {
    no: `Nimesi, syntymäaikasi ja yhteystietosi poistetaan ${months} kk kuluttua. Tuloksesi, sarjasi ja seurasi jäävät tilastoihin nimettömänä.`,
    yes: 'Tiedot säilyvät, kunnes perut luvan.',
  }
}
