// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import { ageOnReference } from '@ert/core'
import type { SqliteDatabase } from './cipher.js'
import { ACCOUNT_TABLES, SCHEMA_SQL } from './schema-sql.js'
export { ACCOUNT_TABLES, SCHEMA_SQL }

export const SCHEMA_VERSION = 4

export interface Migration {
  version: number
  up: (raw: SqliteDatabase) => void
}

export function columnNames(raw: SqliteDatabase, table: string): Set<string> {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((column) => column.name))
}

interface StoredPerson {
  id: string
  gender: 'F' | 'M' | 'X'
  birth_date: string | null
  birth_year: number | null
  publication: string
}

function peopleForPublication(raw: SqliteDatabase): StoredPerson[] {
  const columns = columnNames(raw, 'person')
  const birthDate = columns.has('birth_date') ? 'birth_date' : 'NULL AS birth_date'
  return raw.prepare(`SELECT id, gender, ${birthDate}, birth_year, publication FROM person`).all() as StoredPerson[]
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
      const people = peopleForPublication(raw)
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
      const people = peopleForPublication(raw)
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
  {
    version: 4,
    up(raw) {
      const person = columnNames(raw, 'person')
      if (person.has('birth_date')) {
        raw.exec(`UPDATE person
          SET birth_year = CAST(substr(birth_date, 1, 4) AS INTEGER)
          WHERE birth_year IS NULL AND birth_date IS NOT NULL AND length(birth_date) >= 4`)
        raw.exec('ALTER TABLE person DROP COLUMN birth_date')
      }
      const entry = columnNames(raw, 'entry')
      if (!entry.has('consent_date')) {
        raw.exec(`ALTER TABLE entry ADD COLUMN consent_date TEXT NOT NULL DEFAULT '1970-01-01'`)
        raw.exec(`UPDATE entry
          SET consent_date = strftime('%Y-%m-%d', registered_at / 1000, 'unixepoch')
          WHERE registered_at IS NOT NULL`)
      }
      if (!entry.has('dsq_reason')) {
        raw.exec('ALTER TABLE entry ADD COLUMN dsq_reason TEXT')
      }
      raw.exec(ACCOUNT_TABLES)
      raw.exec('DROP TABLE IF EXISTS key_slot')
    },
  },
]

/**
 * Accounts stay in the encrypted race file.
 * Key slots do not. #131 stores wraps in the sidecar bound to schema_meta.file_id.
 */
/** 16 CSPRNG bytes, hex-encoded. Not secret. Stable for the life of the file, including rekey. */
export function ensureFileId(raw: SqliteDatabase, preferred?: string): string {
  const columns = columnNames(raw, 'schema_meta')
  if (!columns.has('file_id')) raw.exec('ALTER TABLE schema_meta ADD COLUMN file_id TEXT')
  const row = raw.prepare('SELECT file_id FROM schema_meta WHERE id = 1').get() as { file_id: string | null } | undefined
  if (row?.file_id && /^[0-9a-f]{32}$/.test(row.file_id)) return row.file_id
  const fileId = preferred && /^[0-9a-f]{32}$/.test(preferred) ? preferred : randomBytes(16).toString('hex')
  raw.prepare('UPDATE schema_meta SET file_id = ? WHERE id = 1').run(fileId)
  return fileId
}

export interface KeyColumns {
  keyGeneration: number
  temporarySlot: 0 | 1 | null
  /** True when a new recovery key was saved and has not been shown. No key material. */
  recoveryUnshown: boolean
  /** Monotonic id of the latest recovery-key issue. Not key material. */
  recoveryGeneration: number
}

interface KeyMetaRow {
  key_generation: number | null
  temporary_slot: number | null
  recovery_unshown: number | null
  recovery_generation: number | null
}

function asTemporarySlot(value: number | null): 0 | 1 | null {
  if (value === 0 || value === 1) return value
  return null
}

function addKeyColumn(columns: Set<string>, raw: SqliteDatabase, name: string, sql: string): void {
  if (!columns.has(name)) raw.exec(sql)
}

function storedGeneration(value: number | null | undefined): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return 0
}

function readKeyMeta(raw: SqliteDatabase): KeyMetaRow | undefined {
  const sql = 'SELECT key_generation, temporary_slot, recovery_unshown, recovery_generation FROM schema_meta WHERE id = 1'
  return raw.prepare(sql).get() as KeyMetaRow | undefined
}

/** `key_generation` starts at 1. `temporary_slot` is set only for a password that must be replaced. */
export function ensureKeyColumns(raw: SqliteDatabase): KeyColumns {
  const columns = columnNames(raw, 'schema_meta')
  addKeyColumn(columns, raw, 'key_generation', 'ALTER TABLE schema_meta ADD COLUMN key_generation INTEGER')
  addKeyColumn(columns, raw, 'temporary_slot', 'ALTER TABLE schema_meta ADD COLUMN temporary_slot INTEGER')
  addKeyColumn(columns, raw, 'recovery_unshown', 'ALTER TABLE schema_meta ADD COLUMN recovery_unshown INTEGER')
  addKeyColumn(columns, raw, 'recovery_generation', 'ALTER TABLE schema_meta ADD COLUMN recovery_generation INTEGER')
  const row = readKeyMeta(raw)
  const temporarySlot = asTemporarySlot(row?.temporary_slot ?? null)
  const recoveryUnshown = row?.recovery_unshown === 1
  const recoveryGeneration = storedGeneration(row?.recovery_generation)
  if (row?.key_generation && Number.isInteger(row.key_generation) && row.key_generation >= 1) {
    return { keyGeneration: row.key_generation, temporarySlot, recoveryUnshown, recoveryGeneration }
  }
  raw.prepare('UPDATE schema_meta SET key_generation = 1 WHERE id = 1').run()
  return { keyGeneration: 1, temporarySlot, recoveryUnshown, recoveryGeneration }
}

/** Bump the recovery issue id and mark it unshown. The column holds no secret. */
export function issueRecoveryGeneration(raw: SqliteDatabase): number {
  const next = ensureKeyColumns(raw).recoveryGeneration + 1
  if (!Number.isSafeInteger(next)) throw new Error('recovery generation overflow')
  raw.prepare('UPDATE schema_meta SET recovery_generation = ?, recovery_unshown = 1 WHERE id = 1').run(next)
  return next
}

/** Persist that the latest recovery key has not been shown. The column holds no secret. */
export function setRecoveryUnshown(raw: SqliteDatabase, unshown: boolean): void {
  ensureKeyColumns(raw)
  raw.prepare('UPDATE schema_meta SET recovery_unshown = ? WHERE id = 1').run(unshown ? 1 : 0)
}

export function setKeyGeneration(raw: SqliteDatabase, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error('key generation must be a positive integer')
  ensureKeyColumns(raw)
  raw.prepare('UPDATE schema_meta SET key_generation = ? WHERE id = 1').run(value)
}

export function setTemporarySlot(raw: SqliteDatabase, slot: 0 | 1 | null): void {
  ensureKeyColumns(raw)
  raw.prepare('UPDATE schema_meta SET temporary_slot = ? WHERE id = 1').run(slot)
}

/** Encrypted audit row. `reason` is `temporary_password` or `other_admin_present`, never a secret. */
export function recordKeyAudit(raw: SqliteDatabase, action: string, reason: string): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS key_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  raw.prepare('INSERT INTO key_audit (action, reason, created_at) VALUES (?, ?, ?)').run(action, reason, Date.now())
}

