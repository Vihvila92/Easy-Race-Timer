import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { addMonths, createId } from '@ert/core'
import { atomicCopyFile, fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { isPlaintextSqlite, openEncrypted, peekSchemaVersion, rawKeyPragma, restrictPermissions, unlock, type SqliteDatabase } from './cipher.js'
import { RaceFileError } from './errors.js'
import { omitInternal } from './internal.js'
import { devKeyOptIn, isDevDataKey, resolveDataKey, type OpenOptions } from './key.js'
import { backupPairComplete, databasePathForKeyFile, ensureKeyFile, inspectKeyFile, keyFilePath, rekeyTempPaths, writeKeyStub } from './key-file.js'
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

/** Test seam. Production never sets this. A throw leaves the original pair in place. */
export const rekeyHooks: {
  beforeRename?: () => void
} = {}

export { plaintextHooks, QUARANTINE_RETENTION_MS, deleteQuarantinedPlaintext, plaintextQuarantinePending, type PlaintextStep } from './plaintext.js'

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

function migrateOnCopy(filePath: string, dataKey: Buffer, fromVersion: number): void {
  checkpointIfPending(filePath, dataKey)
  const backup = `${filePath}.v${fromVersion}.bak`
  const preferred = peekFileId(filePath, dataKey) ?? randomBytes(16).toString('hex')
  let wroteBackup = false
  try {
    if (migrationHooks.failBackup) throw new Error('disk full')
    atomicCopyFile(filePath, backup)
    wroteBackup = true
    const source = fs.readFileSync(filePath)
    const copied = fs.readFileSync(backup)
    if (!source.equals(copied)) throw new Error('backup bytes differ')
    const sourceKey = keyFilePath(filePath)
    const backupKey = keyFilePath(backup)
    if (backupPairComplete(filePath)) atomicCopyFile(sourceKey, backupKey)
    else writeKeyStub(backupKey, preferred)
    const keyCopy = fs.readFileSync(backupKey)
    if (fs.existsSync(sourceKey) && backupPairComplete(filePath) && !fs.readFileSync(sourceKey).equals(keyCopy)) {
      throw new Error('key backup bytes differ')
    }
    fsyncDirectory(path.dirname(backup))
  } catch {
    if (wroteBackup) {
      secureRemove(backup)
      secureRemove(keyFilePath(backup))
    }
    throw new Error('Pre-migration backup failed; migration was not started.')
  }

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

/**
 * A database temp means the rename did not happen, so the original pair is kept.
 * A key temp alone is the crash window after the database rename. It is attached
 * only when its file id matches. Otherwise both files stay and open fails closed.
 */
function recoverRekeyTemps(filePath: string, dataKey: Buffer): void {
  const temps = rekeyTempPaths(filePath)
  if (fs.existsSync(temps.database)) {
    if (fs.existsSync(filePath)) {
      secureRemove(temps.database)
      secureRemove(`${temps.database}-wal`)
      secureRemove(`${temps.database}-shm`)
      secureRemove(temps.key)
    }
    return
  }
  if (!fs.existsSync(temps.key) || !fs.existsSync(filePath)) return
  let raw: SqliteDatabase | undefined
  try {
    raw = openEncrypted(filePath, dataKey)
    const fileId = ensureFileId(raw)
    const info = inspectKeyFile(temps.key)
    raw.close()
    raw = undefined
    if ((info.kind === 'stub' || info.kind === 'envelope') && info.fileId === fileId) {
      fs.renameSync(temps.key, keyFilePath(filePath))
      fsyncDirectory(path.dirname(filePath))
      restrictPermissions(keyFilePath(filePath))
      return
    }
  } catch (error) {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
    if (error instanceof RaceFileError) throw error
    throw new Error(`Key file recovery failed for ${path.basename(filePath)}.`)
  }
  throw new Error(`Key file recovery failed for ${path.basename(filePath)}.`)
}

/**
 * Open the race database.
 * A file is SQLCipher AES-256. `:memory:` stays unencrypted for unit tests.
 * An older schema is backed up as `<file>.v<version>.bak` plus `<file>.v<version>.keys` before migration.
 * The dev key is used only with an explicit opt-in, and never when the key is missing.
 */
export async function openDatabase(filePath: string, options: OpenOptions = {}): Promise<AppDb> {
  if (filePath === ':memory:') {
    const raw = new Database(':memory:')
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = FULL')
    raw.pragma('foreign_keys = ON')
    raw.pragma('temp_store = MEMORY')
    raw.pragma('secure_delete = ON')
    applyFreshSchema(raw)
    return new AppDb(raw, filePath, null)
  }

  const dataKey = resolveDataKey(options)
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  if (fs.existsSync(resolved)) recoverRekeyTemps(resolved, dataKey)
  recoverPlaintextMigration(resolved, dataKey)
  if (fs.existsSync(resolved) && isPlaintextSqlite(resolved)) migratePlaintextFile(resolved, dataKey)
  const quarantinedPlaintext = quarantinePlaintextCopies(path.dirname(resolved), resolved)
  purgeExpiredQuarantine(path.dirname(resolved))

  if (!fs.existsSync(resolved)) {
    const raw = openEncrypted(resolved, dataKey)
    try {
      applyFreshSchema(raw)
      bindKeyFile(resolved, raw)
      restrictPermissions(resolved)
      return new AppDb(raw, resolved, dataKey, quarantinedPlaintext)
    } catch (error) {
      try {
        raw.close()
      } catch {
        // The handle may already be closed.
      }
      throw error
    }
  }

  const hadWal = fs.existsSync(`${resolved}-wal`) || fs.existsSync(`${resolved}-shm`)
  const current = peekSchemaVersion(resolved, dataKey)
  if (!hadWal) {
    fs.rmSync(`${resolved}-wal`, { force: true })
    fs.rmSync(`${resolved}-shm`, { force: true })
  }
  if (current != null && current > SCHEMA_VERSION) {
    throw new RaceFileError(path.basename(resolved), 'newer')
  }
  if (current != null && current < SCHEMA_VERSION) {
    migrateOnCopy(resolved, dataKey, current)
  }
  const raw = openEncrypted(resolved, dataKey)
  try {
    applyFreshSchema(raw)
    purgeBirthDateColumn(raw)
    bindKeyFile(resolved, raw)
    restrictPermissions(resolved)
    return new AppDb(raw, resolved, dataKey, quarantinedPlaintext)
  } catch (error) {
    try {
      raw.close()
    } catch {
      // The handle may already be closed.
    }
    throw error
  }
}

/** Open with an explicit 256-bit data key. Same migration rules as openDatabase. */
export function openDataFile(filePath: string, dataKey: Buffer): Promise<AppDb> {
  return openDatabase(filePath, { dataKey })
}

function adoptConnection(db: AppDb, raw: SqliteDatabase): void {
  ;(db as { raw: SqliteDatabase }).raw = raw
}

/**
 * Rotate the data key on a copy. The live connection is not rekeyed in place.
 * SQLite3 Multiple Ciphers cannot rekey a database that is in WAL mode, so the
 * copy is switched to DELETE for the rekey and back to WAL after integrity_check.
 * The key stub is copied unchanged. #131 writes the new envelope at that step.
 */
export function rekeyDataFile(db: AppDb, newKey: Buffer): void {
  if (db.filePath === ':memory:' || !db.dataKey) throw new Error('A memory database has no data key to rotate')
  if (newKey.length !== 32) throw new Error('Data key must be 32 bytes')
  if (isDevDataKey(newKey) && !devKeyOptIn()) throw new RaceFileError('', process.env.NODE_ENV === 'production' ? 'dev-key' : 'missing-key')
  const previous = Buffer.from(db.dataKey)
  const incoming = Buffer.from(newKey)
  const temps = rekeyTempPaths(db.filePath)
  const directory = path.dirname(db.filePath)
  let copy: SqliteDatabase | undefined
  let closed = false
  let renamedDatabase = false
  try {
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    atomicCopyFile(db.filePath, temps.database)
    copy = openEncrypted(temps.database, previous)
    copy.pragma('journal_mode = DELETE')
    copy.pragma(rawKeyPragma('rekey', incoming))
    const result = copy.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error('Rekey integrity check failed')
    copy.pragma('journal_mode = WAL')
    copy.close()
    copy = undefined
    const settled = openEncrypted(temps.database, incoming)
    try {
      settled.pragma('wal_checkpoint(TRUNCATE)')
    } finally {
      settled.close()
    }
    fsyncFile(temps.database)
    secureRemove(`${temps.database}-wal`)
    secureRemove(`${temps.database}-shm`)
    const sourceKey = keyFilePath(db.filePath)
    if (!backupPairComplete(db.filePath)) throw new Error('Rekey failed')
    atomicCopyFile(sourceKey, temps.key)
    fsyncFile(temps.key)
    rekeyHooks.beforeRename?.()
    db.raw.close()
    closed = true
    fs.renameSync(temps.database, db.filePath)
    renamedDatabase = true
    fsyncDirectory(directory)
    fs.renameSync(temps.key, sourceKey)
    fsyncDirectory(directory)
    restrictPermissions(db.filePath)
    incoming.copy(db.dataKey)
    const next = openEncrypted(db.filePath, db.dataKey)
    zeroKeyOnClose(next, db.dataKey)
    adoptConnection(db, next)
  } catch (error) {
    try {
      copy?.close()
    } catch {
      // The handle may already be closed.
    }
    if (!renamedDatabase) {
      secureRemove(temps.database)
      secureRemove(`${temps.database}-wal`)
      secureRemove(`${temps.database}-shm`)
      secureRemove(temps.key)
      if (closed && !db.raw.open) {
        previous.copy(db.dataKey!)
        const restored = openEncrypted(db.filePath, db.dataKey!)
        zeroKeyOnClose(restored, db.dataKey!)
        adoptConnection(db, restored)
      }
    } else if (!db.raw.open) {
      incoming.copy(db.dataKey!)
      const restored = openEncrypted(db.filePath, db.dataKey!)
      zeroKeyOnClose(restored, db.dataKey!)
      adoptConnection(db, restored)
    }
    if (error instanceof RaceFileError) throw error
    if (error instanceof Error && error.message === 'Rekey integrity check failed') throw error
    throw new Error('Rekey failed')
  } finally {
    incoming.fill(0)
    previous.fill(0)
  }
}

/**
 * Backup pair order:
 * 1. wal_checkpoint(TRUNCATE) on the open database
 * 2. atomic copy of the database
 * 3. atomic copy of the key file
 * 4. fsync of the destination directory
 * A crash before step 3 leaves a database without its key file. Restore skips that pair.
 */
function writeBackupPair(databaseSource: string, databaseDest: string): void {
  if (!backupPairComplete(databaseSource)) throw new Error('key file missing')
  atomicCopyFile(databaseSource, databaseDest)
  try {
    atomicCopyFile(keyFilePath(databaseSource), keyFilePath(databaseDest))
    fsyncDirectory(path.dirname(databaseDest))
  } catch (error) {
    secureRemove(databaseDest)
    secureRemove(keyFilePath(databaseDest))
    throw error
  }
}

/** Consistent encrypted snapshot of the database and its key file. */
export async function backupDatabase(db: AppDb, dest: string): Promise<void> {
  if (db.filePath === ':memory:' || !db.dataKey) {
    throw new Error('Backup failed: a memory database has no file to copy')
  }
  const destKey = keyFilePath(dest)
  let copied = false
  try {
    bindKeyFile(db.filePath, db.raw)
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    writeBackupPair(db.filePath, dest)
    copied = true
    restrictPermissions(dest)
  } catch (error) {
    if (copied) {
      fs.rmSync(dest, { force: true })
      secureRemove(destKey)
    }
    if (error instanceof RaceFileError) throw error
    throw new Error('Backup failed')
  }
  try {
    assertBackupIntegrity(dest, db.dataKey)
    if (!backupPairComplete(dest)) throw new Error('Backup integrity check failed')
  } catch (error) {
    fs.rmSync(dest, { force: true })
    secureRemove(destKey)
    if (error instanceof Error && error.message.startsWith('Backup integrity check failed')) throw error
    throw new Error('Backup integrity check failed')
  }
}

/**
 * Copy a complete backup pair over dest.
 * A database without its key file, or a key file that is not a whole stub or envelope, is skipped.
 */
export function restoreBackupPair(databaseBackup: string, destDatabase: string): boolean {
  if (!backupPairComplete(databaseBackup)) return false
  writeBackupPair(databaseBackup, destDatabase)
  return true
}

export function assertBackupIntegrity(file: string, dataKey: Buffer): void {
  if (!dataKey || dataKey.length !== 32) throw new Error('Backup integrity check failed')
  const key = dataKey
  let raw: SqliteDatabase | undefined
  try {
    raw = openEncrypted(file, key)
    const result = raw.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`Backup integrity check failed: ${String(result)}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Backup integrity check failed')) throw error
    throw new Error('Backup integrity check failed')
  } finally {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
  }
}

const SCHEMA_BACKUP = /\.sqlite\.v\d+\.bak$/
const KEY_SCHEMA_BACKUP = /\.v\d+\.keys$/

function olderThanRetention(file: string, retentionMonths: number, today: string): boolean {
  const stat = fs.statSync(file)
  const mtime = new Date(stat.mtimeMs).toISOString().slice(0, 10)
  return addMonths(mtime, retentionMonths) < today
}

/** Delete a database backup and the key sidecar copied with it. */
function removeBackupPair(databaseBackup: string, removed: string[]): void {
  secureRemove(databaseBackup)
  removed.push(databaseBackup)
  const key = keyFilePath(databaseBackup)
  if (key !== databaseBackup && fs.existsSync(key)) {
    secureRemove(key)
    removed.push(key)
  }
}

/** An aged sidecar whose database copy is already gone. A sidecar still paired with a database stays. */
function removeOrphanKeyBackup(keyBackup: string, retentionMonths: number, today: string, removed: string[]): void {
  if (!fs.existsSync(keyBackup)) return
  if (fs.existsSync(databasePathForKeyFile(keyBackup))) return
  if (!olderThanRetention(keyBackup, retentionMonths, today)) return
  secureRemove(keyBackup)
  removed.push(keyBackup)
}

/** Delete backup files older than the retention period, including `<file>.v<version>.bak` and the paired key file. */
export function pruneBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  if (!fs.existsSync(directory)) return []
  const today = new Date(now).toISOString().slice(0, 10)
  const removed: string[] = []
  for (const name of fs.readdirSync(directory)) {
    const databaseBackup = name.endsWith('.sqlite') || SCHEMA_BACKUP.test(name)
    if (!databaseBackup) continue
    const full = path.join(directory, name)
    if (olderThanRetention(full, retentionMonths, today)) removeBackupPair(full, removed)
  }
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.keys') && !KEY_SCHEMA_BACKUP.test(name)) continue
    removeOrphanKeyBackup(path.join(directory, name), retentionMonths, today, removed)
  }
  return removed
}

/** Delete aged pre-migration backups beside the live race file. Does not touch the live file or its key sidecar. */
export function pruneSchemaBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  if (!fs.existsSync(directory)) return []
  const today = new Date(now).toISOString().slice(0, 10)
  const removed: string[] = []
  for (const name of fs.readdirSync(directory)) {
    if (!SCHEMA_BACKUP.test(name)) continue
    const full = path.join(directory, name)
    if (olderThanRetention(full, retentionMonths, today)) removeBackupPair(full, removed)
  }
  for (const name of fs.readdirSync(directory)) {
    if (!KEY_SCHEMA_BACKUP.test(name)) continue
    removeOrphanKeyBackup(path.join(directory, name), retentionMonths, today, removed)
  }
  return removed
}
