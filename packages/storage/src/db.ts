// SPDX-License-Identifier: AGPL-3.0-only
import './sqlite-uri.js'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { createId } from '@ert/core'
import { atomicCopyFile, fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { recoverRestore } from './backup-file.js'
import { isPlaintextSqlite, openEncrypted, peekSchemaVersion, restrictPermissions, unlock, type SqliteDatabase } from './cipher.js'
import { RaceFileError } from './errors.js'
import { omitInternal } from './internal.js'
import { resolveDataKey, type OpenOptions } from './key.js'
import { backupPairComplete, ensureKeyFile, keyFilePath, writeKeyStub } from './key-file.js'
import { recoverRekeyTemps } from './rekey.js'
import { migratePlaintextFile, purgeExpiredQuarantine, quarantinePlaintextCopies, recoverPlaintextMigration } from './plaintext.js'
import { ensureFileId, MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

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

export { plaintextHooks, QUARANTINE_RETENTION_MS, deleteQuarantinedPlaintext, plaintextQuarantinePending, type PlaintextStep } from './plaintext.js'
export { rekeyDataFile, rekeyHooks } from './rekey.js'
export { assertBackupIntegrity, backupDatabase, recoverRestore, restoreBackupPair, restoreHooks } from './backup-file.js'
export { BACKUP_KEEP_RECENT, pruneBackups, pruneSchemaBackups } from './backup-prune.js'

function zeroKeyOnClose(raw: SqliteDatabase, dataKey: Buffer): void {
  const close = raw.close.bind(raw)
  raw.close = () => {
    const result = close()
    dataKey.fill(0)
    return result
  }
}

export class AppDb {
  /** Basenames moved to plaintext-quarantine on this open. Empty for a memory database. */
  readonly quarantinedPlaintext: readonly string[]

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
}

function removeMigrationTemp(tmp: string): void {
  secureRemove(tmp)
  secureRemove(`${tmp}-wal`)
  secureRemove(`${tmp}-shm`)
}

function columnNames(raw: SqliteDatabase, table: string): Set<string> {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((column) => column.name))
}

/** Drop a stored birth date and vacuum so the value is not left on a free page. */
function purgeBirthDateColumn(raw: SqliteDatabase): boolean {
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
function checkpointIfPending(filePath: string, dataKey: Buffer): void {
  if (!fs.existsSync(`${filePath}-wal`) && !fs.existsSync(`${filePath}-shm`)) return
  const raw = openEncrypted(filePath, dataKey)
  try {
    raw.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    raw.close()
  }
}

function peekFileId(filePath: string, dataKey: Buffer): string | undefined {
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

function assertPremigrationCopy(filePath: string, backup: string, preferred: string): void {
  if (!fs.readFileSync(filePath).equals(fs.readFileSync(backup))) throw new Error('backup bytes differ')
  const sourceKey = keyFilePath(filePath)
  const backupKey = keyFilePath(backup)
  if (backupPairComplete(filePath)) atomicCopyFile(sourceKey, backupKey)
  else writeKeyStub(backupKey, preferred)
  const keyCopy = fs.readFileSync(backupKey)
  if (fs.existsSync(sourceKey) && backupPairComplete(filePath) && !fs.readFileSync(sourceKey).equals(keyCopy)) {
    throw new Error('key backup bytes differ')
  }
  fsyncDirectory(path.dirname(backup))
}

function writePremigrationBackup(filePath: string, fromVersion: number, preferred: string): string {
  const backup = `${filePath}.v${fromVersion}.bak`
  let wroteBackup = false
  try {
    if (migrationHooks.failBackup) throw new Error('disk full')
    atomicCopyFile(filePath, backup)
    wroteBackup = true
    assertPremigrationCopy(filePath, backup, preferred)
  } catch {
    if (wroteBackup) {
      secureRemove(backup)
      secureRemove(keyFilePath(backup))
    }
    throw new Error('Pre-migration backup failed; migration was not started.')
  }
  return backup
}

function migrateOnCopy(filePath: string, dataKey: Buffer, fromVersion: number): void {
  checkpointIfPending(filePath, dataKey)
  const preferred = peekFileId(filePath, dataKey) ?? randomBytes(16).toString('hex')
  const backup = writePremigrationBackup(filePath, fromVersion, preferred)
  applyMigration(filePath, dataKey, fromVersion, { preferred, backup })
}

function applyMigration(filePath: string, dataKey: Buffer, fromVersion: number, copy: { preferred: string; backup: string }): void {
  const preferred = copy.preferred
  const backup = copy.backup
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.migrating`)
  let migrated = false
  let raw: SqliteDatabase | undefined
  try {
    atomicCopyFile(filePath, tmp)
    raw = openEncrypted(tmp, dataKey)
    const apply = raw.transaction(() => {
      raw!.exec(SCHEMA_SQL)
      for (const migration of MIGRATIONS) {
        if (migration.version > fromVersion && migration.version <= SCHEMA_VERSION) migration.up(raw!)
      }
      raw!.prepare('UPDATE schema_meta SET schema_version = ?, app_version = ? WHERE id = 1').run(SCHEMA_VERSION, APP_VERSION)
      ensureFileId(raw!, preferred)
      migrationHooks.beforeCommit?.()
    })
    apply()
    raw.pragma('secure_delete = ON')
    raw.exec('VACUUM')
    raw.pragma('wal_checkpoint(TRUNCATE)')
    raw.close()
    raw = undefined
    fsyncFile(tmp)
    fs.renameSync(tmp, filePath)
    fsyncDirectory(path.dirname(filePath))
    migrated = true
    restrictPermissions(filePath)
    secureRemove(`${tmp}-wal`)
    secureRemove(`${tmp}-shm`)
    purgeBirthDateBackup(backup, dataKey)
  } catch (error) {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
    if (!migrated) {
      removeMigrationTemp(tmp)
      throw new Error('Migration failed; the original file was left unchanged.')
    }
    throw error
  }
}

/**
 * After a successful migration, a backup that still has birth_date is rewritten without that column.
 * A backup that never had the column is left byte-identical. A purge failure deletes the backup.
 */
function backupHasBirthDate(backup: string, dataKey: Buffer): boolean {
  let raw: SqliteDatabase | undefined
  try {
    raw = new Database(backup, { readonly: true, fileMustExist: true })
    unlock(raw, dataKey)
    return columnNames(raw, 'person').has('birth_date')
  } catch {
    return false
  } finally {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
    fs.rmSync(`${backup}-wal`, { force: true })
    fs.rmSync(`${backup}-shm`, { force: true })
  }
}

function purgeBirthDateBackup(backup: string, dataKey: Buffer): void {
  if (!fs.existsSync(backup) || !backupHasBirthDate(backup, dataKey)) return
  let raw: SqliteDatabase | undefined
  try {
    raw = openEncrypted(backup, dataKey)
    purgeBirthDateColumn(raw)
    raw.pragma('wal_checkpoint(TRUNCATE)')
    raw.close()
    raw = undefined
    restrictPermissions(backup)
    secureRemove(`${backup}-wal`)
    secureRemove(`${backup}-shm`)
  } catch {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
    secureRemove(backup)
    secureRemove(`${backup}-wal`)
    secureRemove(`${backup}-shm`)
    secureRemove(keyFilePath(backup))
  }
}

function bindKeyFile(filePath: string, raw: SqliteDatabase): void {
  ensureKeyFile(filePath, ensureFileId(raw))
}

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

function finishOpen(raw: SqliteDatabase, resolved: string, dataKey: Buffer, open: { quarantined: readonly string[]; purgeBirthDate: boolean }): AppDb {
  try {
    applyFreshSchema(raw)
    if (open.purgeBirthDate) purgeBirthDateColumn(raw)
    bindKeyFile(resolved, raw)
    restrictPermissions(resolved)
    return new AppDb(raw, resolved, dataKey, open.quarantined)
  } catch (error) {
    try {
      raw.close()
    } catch {
      // The handle may already be closed.
    }
    throw error
  }
}

function openExistingFile(resolved: string, dataKey: Buffer, quarantined: readonly string[]): AppDb {
  const hadWal = fs.existsSync(`${resolved}-wal`) || fs.existsSync(`${resolved}-shm`)
  const current = peekSchemaVersion(resolved, dataKey)
  if (!hadWal) {
    fs.rmSync(`${resolved}-wal`, { force: true })
    fs.rmSync(`${resolved}-shm`, { force: true })
  }
  if (current != null && current > SCHEMA_VERSION) throw new RaceFileError(path.basename(resolved), 'newer')
  if (current != null && current < SCHEMA_VERSION) migrateOnCopy(resolved, dataKey, current)
  return finishOpen(openEncrypted(resolved, dataKey), resolved, dataKey, { quarantined, purgeBirthDate: true })
}

/**
 * Open the race database.
 * A file is SQLCipher AES-256. `:memory:` stays unencrypted for unit tests.
 * An older schema is backed up as `<file>.v<version>.bak` plus `<file>.v<version>.keys` before migration.
 * The dev key is used only with an explicit opt-in, and never when the key is missing.
 * A leftover restore is completed or rolled back before the file is used.
 * Close this database before restoring a backup over the same path.
 */
export async function openDatabase(filePath: string, options: OpenOptions = {}): Promise<AppDb> {
  if (filePath === ':memory:') return openMemoryDatabase()
  const dataKey = resolveDataKey(options)
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  recoverRestore(resolved)
  if (fs.existsSync(resolved)) recoverRekeyTemps(resolved, dataKey)
  recoverPlaintextMigration(resolved, dataKey)
  if (fs.existsSync(resolved) && isPlaintextSqlite(resolved)) migratePlaintextFile(resolved, dataKey)
  const quarantinedPlaintext = quarantinePlaintextCopies(path.dirname(resolved), resolved)
  purgeExpiredQuarantine(path.dirname(resolved))
  const open = { quarantined: quarantinedPlaintext, purgeBirthDate: false }
  if (!fs.existsSync(resolved)) return finishOpen(openEncrypted(resolved, dataKey), resolved, dataKey, open)
  return openExistingFile(resolved, dataKey, quarantinedPlaintext)
}

/** Open with an explicit 256-bit data key. Same migration rules as openDatabase. */
export function openDataFile(filePath: string, dataKey: Buffer): Promise<AppDb> {
  return openDatabase(filePath, { dataKey })
}
