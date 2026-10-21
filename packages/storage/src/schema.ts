// SPDX-License-Identifier: AGPL-3.0-only
import { ageOnReference } from '@ert/core'

export const SCHEMA_VERSION = 3

export interface Migration {
  version: number
  up: (raw: import('better-sqlite3').Database) => void
}

/** Applied in order when schema_meta.schema_version is behind SCHEMA_VERSION. */
export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    up(raw) {
      const columns = raw.prepare('PRAGMA table_info(person)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'publication')) {
        raw.exec(`ALTER TABLE person ADD COLUMN publication TEXT NOT NULL DEFAULT 'full' CHECK (publication IN ('full', 'initials', 'bib_only', 'hidden'))`)
      }
      const event = raw.prepare('SELECT date_start, settings_json FROM event LIMIT 1').get() as { date_start: string; settings_json: string } | undefined
      if (!event) return
      let basis: 'birth_date' | 'birth_year' = 'birth_date'
      let reference = event.date_start
      try {
        const settings = JSON.parse(event.settings_json) as { age_basis?: string; age_reference_date?: string }
        if (settings.age_basis === 'birth_year') basis = 'birth_year'
        if (settings.age_reference_date) reference = settings.age_reference_date
      } catch {
        reference = event.date_start
      }
      const people = raw.prepare('SELECT id, gender, birth_date, birth_year, publication FROM person').all() as { id: string; gender: 'F' | 'M' | 'X'; birth_date: string | null; birth_year: number | null; publication: string }[]
      const update = raw.prepare(`UPDATE person SET publication = 'initials' WHERE id = ? AND publication = 'full'`)
      for (const person of people) {
        if (person.publication !== 'full') continue
        try {
          const { age } = ageOnReference(
            { gender: person.gender, birthDate: person.birth_date, birthYear: person.birth_year },
            basis,
            reference,
          )
          if (age < 15) update.run(person.id)
        } catch {
          update.run(person.id)
        }
      }
    },
  },
  {
    version: 3,
    up(raw) {
      const event = raw.prepare('SELECT date_start, settings_json FROM event LIMIT 1').get() as { date_start: string; settings_json: string } | undefined
      if (!event) return
      let basis: 'birth_date' | 'birth_year' = 'birth_date'
      let reference = event.date_start
      try {
        const settings = JSON.parse(event.settings_json) as { age_basis?: string; age_reference_date?: string }
        if (settings.age_basis === 'birth_year') basis = 'birth_year'
        if (settings.age_reference_date) reference = settings.age_reference_date
      } catch {
        reference = event.date_start
      }
      const people = raw.prepare('SELECT id, gender, birth_date, birth_year, publication FROM person').all() as { id: string; gender: 'F' | 'M' | 'X'; birth_date: string | null; birth_year: number | null; publication: string }[]
      const update = raw.prepare(`UPDATE person SET publication = 'initials' WHERE id = ? AND publication = 'full'`)
      for (const person of people) {
        if (person.publication !== 'full') continue
        try {
          ageOnReference(
            { gender: person.gender, birthDate: person.birth_date, birthYear: person.birth_year },
            basis,
            reference,
          )
        } catch {
          update.run(person.id)
        }
      }
    },
  },
]

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  installation_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  organizer TEXT,
  location TEXT,
  date_start TEXT NOT NULL,
  date_end TEXT,
  timezone TEXT NOT NULL,
  sport TEXT NOT NULL,
  locale_default TEXT NOT NULL DEFAULT 'fi',
  pin_hash TEXT,
  locked_at INTEGER,
  settings_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  hlc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  event_id TEXT NOT NULL,
  name_fi TEXT NOT NULL,
  name_en TEXT NOT NULL,
  distance_m INTEGER NOT NULL,
  start_mode TEXT NOT NULL,
  scheduled_start INTEGER,
  actual_start_ms INTEGER,
  open_category_id TEXT,
  stage_no INTEGER NOT NULL DEFAULT 1,
  laps INTEGER NOT NULL DEFAULT 1,
  locked_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  hlc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name_fi TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_fi TEXT,
  description_en TEXT,
  gender TEXT,
  min_age INTEGER,
  max_age INTEGER,
  ranked INTEGER NOT NULL DEFAULT 1,
  auto_assign INTEGER NOT NULL DEFAULT 1,
  start_offset_ms INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  birth_date TEXT,
  birth_year INTEGER,
  default_club_id TEXT,
  nationality TEXT,
  email TEXT,
  phone TEXT,
  guardian_name TEXT,
  guardian_email TEXT,
  retention_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  hlc TEXT NOT NULL,
  publication TEXT NOT NULL DEFAULT 'full' CHECK (publication IN ('full', 'initials', 'bib_only', 'hidden'))
);

CREATE TABLE IF NOT EXISTS club (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  abbreviation TEXT,
  name TEXT NOT NULL,
  municipality TEXT,
  official_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  merged_into_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  hlc TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS club_abbr_unique
  ON club(org_id, lower(abbreviation))
  WHERE abbreviation IS NOT NULL AND status <> 'merged';

CREATE TABLE IF NOT EXISTS club_alias (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  club_id TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_from TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(org_id, alias_normalized)
);

CREATE TABLE IF NOT EXISTS consent (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  purpose TEXT NOT NULL,
  granted INTEGER NOT NULL,
  given_by TEXT NOT NULL,
  guardian_name TEXT,
  text_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  recorded_by TEXT,
  recorded_at INTEGER NOT NULL,
  evidence_json TEXT
);

CREATE TABLE IF NOT EXISTS entry (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  race_id TEXT NOT NULL,
  person_id TEXT,
  category_id TEXT,
  category_source TEXT NOT NULL DEFAULT 'auto',
  bib INTEGER,
  registered_at INTEGER NOT NULL,
  late_registration INTEGER NOT NULL DEFAULT 0,
  club_id TEXT,
  club_raw TEXT,
  club_abbr_raw TEXT,
  display_name TEXT,
  birth_year_at_entry INTEGER,
  gender_at_entry TEXT,
  anonymized_at INTEGER,
  start_offset_ms INTEGER NOT NULL DEFAULT 0,
  start_offset_reason TEXT,
  offset_ranking TEXT NOT NULL DEFAULT 'inherit',
  status TEXT NOT NULL DEFAULT 'registered',
  status_reason TEXT,
  race_change_note TEXT,
  warnings_json TEXT,
  result_order INTEGER,
  reg_seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  hlc TEXT NOT NULL,
  CHECK (bib IS NULL OR bib > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS entry_bib_unique ON entry(race_id, bib) WHERE bib IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entry_person_unique ON entry(race_id, person_id) WHERE person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS timing_point (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  race_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  distance_m INTEGER
);

CREATE TABLE IF NOT EXISTS device (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT,
  is_primary_clock INTEGER NOT NULL DEFAULT 0,
  operator_name TEXT,
  next_seq INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS timing_event (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  race_id TEXT NOT NULL,
  timing_point_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seq_no INTEGER NOT NULL,
  source TEXT NOT NULL,
  device_time_ms INTEGER NOT NULL,
  monotonic_ms INTEGER,
  time_ms INTEGER NOT NULL,
  bib INTEGER,
  entry_id TEXT,
  mode TEXT,
  raw_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(device_id, seq_no)
);

CREATE TABLE IF NOT EXISTS correction (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  reason TEXT NOT NULL,
  by_device_id TEXT,
  hlc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tie_resolution (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'local',
  race_id TEXT NOT NULL,
  display_time TEXT NOT NULL,
  display_time_s INTEGER NOT NULL,
  member_entry_ids_json TEXT NOT NULL,
  order_json TEXT,
  basis TEXT,
  reason TEXT,
  confirmed_by_device_id TEXT,
  reopened INTEGER NOT NULL DEFAULT 0,
  hlc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clock_sample (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  reference_device_id TEXT,
  method TEXT NOT NULL,
  offset_ms INTEGER NOT NULL,
  uncertainty_ms INTEGER NOT NULL,
  rtt_ms INTEGER,
  measured_at_device_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  device_id TEXT NOT NULL,
  from_device_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL,
  PRIMARY KEY (device_id, from_device_id)
);
`
