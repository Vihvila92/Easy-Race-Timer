// SPDX-License-Identifier: AGPL-3.0-only
import './sqlite-uri.js'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { createId } from '@ert/core'
import { fsyncDirectory, secureRemove } from './atomic.js'
import { isPlaintextSqlite, openEncrypted, peekSchemaVersion, restrictPermissions, unlock, type SqliteDatabase } from './cipher.js'
import { RaceFileError } from './errors.js'
import { omitInternal } from './internal.js'
import { resolveDataKey, type OpenOptions } from './key.js'
import { ensureKeyFile, inspectKeyFile, keyFilePath, rekeyTempPaths } from './key-file.js'
import { migratePlaintextFile, purgeExpiredQuarantine, quarantinePlaintextCopies, recoverPlaintextMigration } from './plaintext.js'
import { readEnvelopeIdentity } from './key-envelope.js'
import { migrateOnCopy } from './migrate-copy.js'
import { columnNames, ensureFileId, ensureKeyColumns, SCHEMA_SQL, SCHEMA_VERSION, setKeyGeneration } from './schema.js'

export { columnNames }

export const APP_VERSION = '0.1.0'
export const ORG_ID = 'local'

export type Row = Record<string, unknown>

/**
 * Test seam for crash and rollback tests. Production never sets these.
 * `beforeCommit` runs inside the migration transaction on the copy, before it commits.
 */
export const migrationHooks: {
  beforeCommit?: () => void
  failBackup?: boolean
} = {}

export type RekeyPhase =
  | 'checkpoint-before-copy'
  | 'journal-delete'
  | 'before-rekey'
  | 'rekey'
  | 'integrity-ok'
  | 'journal-wal'
  | 'checkpoint-after-rekey'

export interface RekeyPhaseInfo {
  file: string
  journal?: string
}

/** Test seam. Production never sets this. A throw leaves the original pair in place. */
export const rekeyHooks: {
  beforeRename?: () => void
  afterDatabaseRename?: () => void
  onPhase?: (phase: RekeyPhase, info: RekeyPhaseInfo) => void
} = {}

export interface RekeyOptions {
  /** Runs on the copy after journal_mode DELETE and before PRAGMA rekey. */
  prepareCopy?: (copy: SqliteDatabase) => void
  /** Writes the key temp. The default copies the current key file. */
  writeKeyFile?: (tempKeyPath: string) => void
}

/** Test seam for backup pair order. Production never sets this. */
export const backupHooks: {
  onStep?: (step: 'database' | 'key' | 'directory') => void
} = {}

export { plaintextHooks, QUARANTINE_RETENTION_MS, deleteQuarantinedPlaintext, plaintextQuarantinePending, type PlaintextStep } from './plaintext.js'

export function zeroKeyOnClose(raw: SqliteDatabase, dataKey: Buffer): void {
  const close = raw.close.bind(raw)
  raw.close = () => {
    const result = close()
    dataKey.fill(0)
    return result
  }
}

export interface KeySession {
  kind: 'admin' | 'recovery-gate' | 'temporary-password'
  slotIndex: 0 | 1 | 2
}

export class AppDb {
  /** Basenames moved to plaintext-quarantine on this open. Empty for a memory database. */
  readonly quarantinedPlaintext: readonly string[]
  /** Set when a slot unwrap opened this handle. A dev-key open leaves it null. */
  keySession: KeySession | null = null

  constructor(
    readonly raw: SqliteDatabase,
    readonly filePath: string,
    /** Null for an in-memory database. Never log this value. Filled with zeros when the handle closes. */
    readonly dataKey: Buffer | null,
    quarantinedPlaintext: readonly string[] = [],
  ) {
    this.quarantinedPlaintext = quarantinedPlaintext
    if (dataKey) zeroKeyOnClose(raw, dataKey)
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[]
  }

  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.raw.prepare(sql).run(...params)
  }

  tx<T>(fn: () => T): T {
    return this.raw.transaction(fn)()
  }

  snapshot(): Record<string, Row[]> {
    const tables = ['event', 'race', 'category', 'person', 'club', 'club_alias', 'consent', 'entry', 'timing_point', 'device', 'timing_event', 'correction', 'tie_resolution', 'schema_meta']
    const data: Record<string, Row[]> = {}
    for (const table of tables) data[table] = this.all<Row>(`SELECT * FROM ${table}`)
    data.event = data.event.map((row) => {
      const copy = { ...row }
      delete copy.pin_hash
      return copy
    })
    data.entry = data.entry.map((row) => omitInternal('entry', row))
    data.correction = data.correction.map(redactDsqAudit)
    return data
  }
}

/** DSQ free text stays in entry.dsq_reason. The exported audit row does not repeat it. */
function redactDsqAudit(row: Row): Row {
  if (row.action !== 'set_status') return row
  const next = typeof row.new_value_json === 'string' ? row.new_value_json : ''
  if (!/"status"\s*:\s*"dsq"/.test(next)) return row
  return { ...row, reason: 'set_status:dsq' }
}

function readSchemaVersion(raw: SqliteDatabase): number | undefined {
  const existing = raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'`).get() as { name: string } | undefined
  if (!existing) return undefined
  return (raw.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get() as { schema_version: number } | undefined)?.schema_version
}

function applyFreshSchema(raw: SqliteDatabase): void {
  raw.exec(SCHEMA_SQL)
  raw.exec('DROP TABLE IF EXISTS key_slot')
  const current = readSchemaVersion(raw)
  if (current == null) {
    raw.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, ?, ?, ?)').run(SCHEMA_VERSION, APP_VERSION, createId())
  }
  ensureFileId(raw)
  ensureKeyColumns(raw)
}

export function removeMigrationTemp(tmp: string): void {
  secureRemove(tmp)
  secureRemove(`${tmp}-wal`)
  secureRemove(`${tmp}-shm`)
}

/** Drop a stored birth date and vacuum so the value is not left on a free page. */
export function purgeBirthDateColumn(raw: SqliteDatabase): boolean {
  if (!columnNames(raw, 'person').has('birth_date')) return false
  raw.pragma('secure_delete = ON')
  raw.exec(`UPDATE person
    SET birth_year = CAST(substr(birth_date, 1, 4) AS INTEGER)
    WHERE birth_year IS NULL AND birth_date IS NOT NULL AND length(birth_date) >= 4`)
  raw.exec('ALTER TABLE person DROP COLUMN birth_date')
  raw.exec('VACUUM')
  return true
}

/**
 * Copy the encrypted file, migrate the copy, then rename it over the original.
 * A crash before the rename leaves the original file untouched.
 */
export function checkpointIfPending(filePath: string, dataKey: Buffer): void {
  if (!fs.existsSync(`${filePath}-wal`) && !fs.existsSync(`${filePath}-shm`)) return
  const raw = openEncrypted(filePath, dataKey)
  try {
    raw.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    raw.close()
  }
}

export function peekFileId(filePath: string, dataKey: Buffer): string | undefined {
  let raw: SqliteDatabase | undefined
  try {
    raw = new Database(filePath, { readonly: true, fileMustExist: true })
    unlock(raw, dataKey)
    if (!columnNames(raw, 'schema_meta').has('file_id')) return undefined
    const row = raw.prepare('SELECT file_id FROM schema_meta WHERE id = 1').get() as { file_id: string | null } | undefined
    if (row?.file_id && /^[0-9a-f]{32}$/.test(row.file_id)) return row.file_id
    return undefined
  } catch {
    return undefined
  } finally {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
  }
}


export function bindKeyFile(filePath: string, raw: SqliteDatabase): void {
  ensureKeyFile(filePath, ensureFileId(raw))
}

/**
 * A database temp means the rename did not happen, so the original pair is kept.
 * A key temp alone is the crash window after the database rename. It is attached
 * only when its file id matches. Otherwise both files stay and open fails closed.
 */
function discardRekeyDatabaseTemp(filePath: string): boolean {
  const temps = rekeyTempPaths(filePath)
  if (!fs.existsSync(temps.database)) return false
  if (fs.existsSync(filePath)) {
    secureRemove(temps.database)
    secureRemove(`${temps.database}-wal`)
    secureRemove(`${temps.database}-shm`)
    secureRemove(temps.key)
  }
  return true
}

function keyTempMatches(filePath: string, fileId: string, generation: number): boolean {
  const info = inspectKeyFile(rekeyTempPaths(filePath).key)
  if (info.fileId !== fileId) return false
  if (info.kind === 'stub') return true
  if (info.kind !== 'envelope') return false
  const identity = readEnvelopeIdentity(fs.readFileSync(rekeyTempPaths(filePath).key))
  return Boolean(identity && identity.keyGeneration === generation)
}

function recoverRekeyTemps(filePath: string, dataKey: Buffer): void {
  if (discardRekeyDatabaseTemp(filePath)) return
  const temps = rekeyTempPaths(filePath)
  if (!fs.existsSync(temps.key) || !fs.existsSync(filePath)) return
  const raw = openEncrypted(filePath, dataKey)
  try {
    const fileId = ensureFileId(raw)
    const generation = ensureKeyColumns(raw).keyGeneration
    raw.close()
    if (!keyTempMatches(filePath, fileId, generation)) throw new Error(`Key file recovery failed for ${path.basename(filePath)}.`)
    fs.renameSync(temps.key, keyFilePath(filePath))
    fsyncDirectory(path.dirname(filePath))
    restrictPermissions(keyFilePath(filePath))
  } catch (error) {
    try { raw.close() } catch { /* The handle may already be closed. */ }
    if (error instanceof RaceFileError) throw error
    throw new Error(`Key file recovery failed for ${path.basename(filePath)}.`)
  }
}

/**
 * Open the race database.
 * A file is SQLCipher AES-256. `:memory:` stays unencrypted for unit tests.
 * An older schema is backed up as `<file>.v<version>.bak` plus `<file>.v<version>.keys` before migration.
 * The dev key is used only with an explicit opt-in, and never when the key is missing.
 */
function openMemoryDatabase(): AppDb {
  const raw = new Database(':memory:')
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = FULL')
  raw.pragma('foreign_keys = ON')
  raw.pragma('temp_store = MEMORY')
  raw.pragma('secure_delete = ON')
  applyFreshSchema(raw)
  return new AppDb(raw, ':memory:', null)
}

function openPrepared(filePath: string, dataKey: Buffer, quarantined: readonly string[], fresh: boolean): AppDb {
  const raw = openEncrypted(filePath, dataKey)
  try {
    applyFreshSchema(raw)
    if (!fresh) purgeBirthDateColumn(raw)
    bindKeyFile(filePath, raw)
    restrictPermissions(filePath)
    return new AppDb(raw, filePath, dataKey, quarantined)
  } catch (error) {
    try { raw.close() } catch { /* The handle may already be closed. */ }
    throw error
  }
}

function migrateIfOlder(filePath: string, dataKey: Buffer): void {
  const hadWal = fs.existsSync(`${filePath}-wal`) || fs.existsSync(`${filePath}-shm`)
  const current = peekSchemaVersion(filePath, dataKey)
  if (!hadWal) {
    fs.rmSync(`${filePath}-wal`, { force: true })
    fs.rmSync(`${filePath}-shm`, { force: true })
  }
  if (current != null && current > SCHEMA_VERSION) throw new RaceFileError(path.basename(filePath), 'newer')
  if (current != null && current < SCHEMA_VERSION) migrateOnCopy(filePath, dataKey, current)
}

export async function openDatabase(filePath: string, options: OpenOptions = {}): Promise<AppDb> {
  if (filePath === ':memory:') return openMemoryDatabase()
  const dataKey = resolveDataKey(options)
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  if (fs.existsSync(resolved)) recoverRekeyTemps(resolved, dataKey)
  recoverPlaintextMigration(resolved, dataKey)
  if (fs.existsSync(resolved) && isPlaintextSqlite(resolved)) migratePlaintextFile(resolved, dataKey)
  const quarantined = quarantinePlaintextCopies(path.dirname(resolved), resolved)
  purgeExpiredQuarantine(path.dirname(resolved))
  if (!fs.existsSync(resolved)) return openPrepared(resolved, dataKey, quarantined, true)
  migrateIfOlder(resolved, dataKey)
  return openPrepared(resolved, dataKey, quarantined, false)
}

/** Open with an explicit 256-bit data key. Same migration rules as openDatabase. */
export function openDataFile(filePath: string, dataKey: Buffer): Promise<AppDb> {
  return openDatabase(filePath, { dataKey })
}

/** Create a new race file and bind `file_id` and `key_generation`. Does not write the key file. */
export function initializeEncryptedFile(filePath: string, dataKey: Buffer, fileIdHex: string, keyGeneration: number): AppDb {
  if (filePath === ':memory:') throw new Error('A memory database has no key file')
  if (!/^[0-9a-f]{32}$/.test(fileIdHex)) throw new Error('file id must be 32 hex characters')
  const resolved = path.resolve(filePath)
  if (fs.existsSync(resolved)) throw new Error('Race file already exists')
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const raw = openEncrypted(resolved, dataKey)
  try {
    applyFreshSchema(raw)
    raw.prepare('UPDATE schema_meta SET file_id = ? WHERE id = 1').run(fileIdHex)
    setKeyGeneration(raw, keyGeneration)
    restrictPermissions(resolved)
    return new AppDb(raw, resolved, Buffer.from(dataKey))
  } catch (error) {
    try {
      raw.close()
    } catch {
      // The handle may already be closed.
    }
    secureRemove(resolved)
    secureRemove(`${resolved}-wal`)
    secureRemove(`${resolved}-shm`)
    throw error
  }
}

export { assertBackupIntegrity, backupDatabase, pruneBackups, pruneSchemaBackups, restoreBackupPair } from './backup-file.js'
export { rekeyDataFile } from './rekey.js'
