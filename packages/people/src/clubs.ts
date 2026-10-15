export interface ClubRef {
  id: string
  abbreviation: string | null
  name: string
  aliases?: string[]
  municipality?: string
  officialId?: string
  status?: 'active' | 'pending' | 'merged'
}

export type ClubMatchType =
  | 'abbreviation'
  | 'name'
  | 'normalized_name'
  | 'fuzzy_suggestion'
  | 'new'
  | 'abbreviation_conflict'
  | 'none'

export function norm(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function tokenPrefix(a: string, b: string): boolean {
  const left = norm(a).replaceAll('.', '').split(/\s+/).filter(Boolean)
  const right = norm(b).replaceAll('.', '').split(/\s+/).filter(Boolean)
  if (left.length !== right.length || left.join('\0') === right.join('\0')) return false
  return left.every((token, index) => right[index].startsWith(token))
}

function matchingSize(a: string, b: string): number {
  if (!a.length || !b.length) return 0
  let bestLength = 0
  let bestI = 0
  let bestJ = 0
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        lengths[i][j] = lengths[i - 1][j - 1] + 1
        if (lengths[i][j] > bestLength) {
          bestLength = lengths[i][j]
          bestI = i - bestLength
          bestJ = j - bestLength
        }
      }
    }
  }
  if (!bestLength) return 0
  return bestLength
    + matchingSize(a.slice(0, bestI), b.slice(0, bestJ))
    + matchingSize(a.slice(bestI + bestLength), b.slice(bestJ + bestLength))
}

export function similar(a: string, b: string): boolean {
  if (tokenPrefix(a, b) || tokenPrefix(b, a)) return true
  const left = norm(a)
  const right = norm(b)
  if (!left && !right) return true
  const ratio = (2 * matchingSize(left, right)) / (left.length + right.length || 1)
  return ratio >= 0.9
}

export function newClubId(abbreviation: string | null, name: string): string {
  const letters = (abbreviation || name).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
  return `CL_NEW_${letters}`
}

function resolveOne(
  name: string,
  abbreviation: string,
  registry: ClubRef[],
  proposals: ClubRef[],
): { type: ClubMatchType; clubId: string } {
  const pool = [...registry, ...proposals]
  const byAbbreviation = new Map<string, ClubRef>()
  for (const club of pool) {
    if (club.abbreviation) byAbbreviation.set(norm(club.abbreviation), club)
  }
  for (const key of [abbreviation, name]) {
    const club = key ? byAbbreviation.get(norm(key)) : undefined
    if (!club) continue
    const aliases = club.aliases ?? []
    if (name && norm(name) !== norm(key) && norm(name) !== norm(club.name) && !aliases.includes(norm(name))) {
      return { type: 'abbreviation_conflict', clubId: club.id }
    }
    return { type: 'abbreviation', clubId: club.id }
  }
  for (const club of pool) {
    if (name && (norm(name) === norm(club.name) || (club.aliases ?? []).includes(norm(name)))) {
      return { type: name === club.name ? 'name' : 'normalized_name', clubId: club.id }
    }
  }
  if (!name) return { type: 'none', clubId: '' }
  const fuzzy = registry.find((club) => club.abbreviation && similar(name, club.name))
  if (fuzzy) return { type: 'fuzzy_suggestion', clubId: fuzzy.id }
  const created: ClubRef = {
    id: newClubId(abbreviation || null, name),
    abbreviation: abbreviation || null,
    name,
    aliases: [],
    status: 'pending',
  }
  proposals.push(created)
  return { type: 'new', clubId: created.id }
}

export interface ClubRecognition {
  name: string
  abbreviation: string
  type: ClubMatchType
  clubId: string
  rows: number
}

/** Recognize distinct club values in first-seen order. Proposals are visible to later rows. */
export function recognizeClubs(rows: { name: string; abbreviation: string }[], registry: ClubRef[]): {
  matches: ClubRecognition[]
  proposals: ClubRef[]
  byKey: Map<string, { type: ClubMatchType; clubId: string }>
} {
  const proposals: ClubRef[] = []
  const byKey = new Map<string, { type: ClubMatchType; clubId: string }>()
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.name}\0${row.abbreviation}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (!byKey.has(key)) byKey.set(key, resolveOne(row.name, row.abbreviation, registry, proposals))
  }
  const matches: ClubRecognition[] = []
  for (const [key, match] of byKey) {
    const [name, abbreviation] = key.split('\0')
    matches.push({
      name,
      abbreviation,
      type: match.type,
      clubId: match.clubId,
      rows: counts.get(key) ?? 0,
    })
  }
  return { matches, proposals, byKey }
}

export function searchClubs(clubs: ClubRef[], query: string): ClubRef[] {
  const needle = norm(query)
  if (!needle) return []
  const active = clubs.filter((club) => club.status !== 'merged')
  const abbreviationHits = active.filter((club) => club.abbreviation && norm(club.abbreviation) === needle)
  const nameHits = active.filter((club) =>
    !abbreviationHits.includes(club)
    && (norm(club.name).startsWith(needle) || (club.aliases ?? []).some((alias) => alias.startsWith(needle))))
  return [...abbreviationHits, ...nameHits]
}

export function findDuplicatePairs(clubs: ClubRef[]): { sourceId: string; targetId: string; reason: string }[] {
  const active = clubs.filter((club) => club.status !== 'merged')
  const pairs: { sourceId: string; targetId: string; reason: string }[] = []
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i]
      const right = active[j]
      if (similar(left.name, right.name)) {
        const source = left.abbreviation ? right : left
        const target = left.abbreviation ? left : right
        pairs.push({ sourceId: source.id, targetId: target.id, reason: 'similar_name' })
      } else if (left.officialId && left.officialId === right.officialId) {
        pairs.push({ sourceId: right.id, targetId: left.id, reason: 'official_id' })
      } else if (left.abbreviation && (right.aliases ?? []).includes(norm(left.abbreviation))) {
        pairs.push({ sourceId: right.id, targetId: left.id, reason: 'alias' })
      } else if (right.abbreviation && (left.aliases ?? []).includes(norm(right.abbreviation))) {
        pairs.push({ sourceId: left.id, targetId: right.id, reason: 'alias' })
      }
    }
  }
  return pairs
}
