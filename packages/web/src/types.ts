export interface ResultRow {
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

export interface ClubMatch {
  name: string
  abbreviation: string
  type: string
  clubId: string
  rows: number
}

export interface Preview {
  count: number
  errors: number
  rows: {
    bib: string | number
    name: string
    birth_date: { categoryId: string; warnings: string; age: number }
    birth_year: { categoryId: string; warnings: string; age: number }
    clubRaw: string
    clubAbbr: string
  }[]
  clubs: ClubMatch[]
}

export interface Suggestion {
  bib: number | null
  name: string | null
  raceId: string
  age: number
  categoryId: string
  warnings: string
}

export interface TieGroup {
  raceId: string
  displayTime: string
  status: 'confirmed' | 'unconfirmed'
  members: { entryId: string; bib: number | null; name: string; categoryId: string; timeMs: number }[]
  basis: string | null
  reason: string | null
}

export interface Workspace {
  event?: {
    id: string
    name: string
    organizer: string
    location: string
    date_start: string
    timezone: string
    has_pin: number
  }
  races: {
    id: string
    name_fi: string
    name_en: string
    distance_m: number
    actual_start_ms: number | null
    locked_at: number | null
  }[]
  categories: { id: string; race_id: string; name_fi: string; name_en: string; ranked: number }[]
  settings: { age_basis: 'birth_date' | 'birth_year'; offset_start_policy_default: 'ranked' | 'unranked' | 'open_category'; retention_months: number }
  clubs: { id: string; abbreviation: string | null; name: string; municipality: string; status: string; entries: number }[]
  duplicates: { sourceId: string; targetId: string; reason: string }[]
  entries: {
    id: string
    race_id: string
    bib: number | null
    display_name: string | null
    club_id: string | null
    category_id: string | null
    status: string
    start_offset_ms: number
    late_registration: number
  }[]
  timing: { id: string; bib: number | null; time_ms: number; voided: boolean; mode: string | null; flags: string[] }[]
  ties: TieGroup[]
  audit: { id: string; action: string; reason: string }[]
  results: ResultRow[]
  clubStats: { race: string; club_abbr: string; club_name: string; entrants: string; finishers: string; published_as: string }[]
  counts: { entries: number; consents: number; clubs: number; timing: number }
}
