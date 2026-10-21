import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { addMonths, createId } from '@ert/core'
import { atomicCopyFile, fsyncDirectory, fsyncFile } from './atomic.js'
import { openEncrypted, peekSchemaVersion, restrictPermissions, type SqliteDatabase } from './cipher.js'
import { RaceFileError } from './errors.js'
import { omitInternal } from './internal.js'
import { resolveDataKey, type OpenOptions } from './key.js'
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

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

export class AppDb {
  constructor(
    readonly raw: SqliteDatabase,
    readonly filePath: string,
    /** Null for an in-memory database. Never log this value. */
    readonly dataKey: Buffer | null,
  ) {}

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
    return data
  }
}

function readSchemaVersion(raw: SqliteDatabase): number | undefined {
  const existing = raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'`).get() as { name: string } | undefined
  if (!existing) return undefined
  return (raw.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get() as { schema_version: number } | undefined)?.schema_version
}

function applyFreshSchema(raw: SqliteDatabase): void {
  raw.exec(SCHEMA_SQL)
  const current = readSchemaVersion(raw)
  if (current == null) {
    raw.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, ?, ?, ?)').run(SCHEMA_VERSION, APP_VERSION, createId())
  }
}

function removeMigrationTemp(tmp: string): void {
  fs.rmSync(tmp, { force: true })
  fs.rmSync(`${tmp}-wal`, { force: true })
  fs.rmSync(`${tmp}-shm`, { force: true })
}

/**
 * Copy the encrypted file, migrate the copy, then rename it over the original.
 * A crash before the rename leaves the original file untouched.
 */
function migrateOnCopy(filePath: string, dataKey: Buffer, fromVersion: number): void {
  const backup = `${filePath}.v${fromVersion}.bak`
  try {
    if (migrationHooks.failBackup) throw new Error('disk full')
    atomicCopyFile(filePath, backup)
    const source = fs.readFileSync(filePath)
    const copied = fs.readFileSync(backup)
    if (!source.equals(copied)) throw new Error('backup bytes differ')
  } catch {
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
      migrationHooks.beforeCommit?.()
    })
    apply()
    raw.pragma('wal_checkpoint(TRUNCATE)')
    raw.close()
    raw = undefined
    fsyncFile(tmp)
    fs.renameSync(tmp, filePath)
    fsyncDirectory(path.dirname(filePath))
    migrated = true
    restrictPermissions(filePath)
    fs.rmSync(`${tmp}-wal`, { force: true })
    fs.rmSync(`${tmp}-shm`, { force: true })
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
 * Open the race database.
 * A file is SQLCipher AES-256. `:memory:` stays unencrypted for unit tests.
 * An older schema is backed up as `<file>.v<version>.bak` (byte-identical) before migration.
 */
export async function openDatabase(filePath: string, options: OpenOptions = {}): Promise<AppDb> {
  if (filePath === ':memory:') {
    const raw = new Database(':memory:')
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = FULL')
    raw.pragma('foreign_keys = ON')
    raw.pragma('temp_store = MEMORY')
    applyFreshSchema(raw)
    return new AppDb(raw, filePath, null)
  }

  const dataKey = resolveDataKey(options)
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })

  if (!fs.existsSync(resolved)) {
    const raw = openEncrypted(resolved, dataKey)
    try {
      applyFreshSchema(raw)
      restrictPermissions(resolved)
      return new AppDb(raw, resolved, dataKey)
    } catch (error) {
      try {
        raw.close()
      } catch {
        // The handle may already be closed.
      }
      throw error
    }
  }

  const current = peekSchemaVersion(resolved, dataKey)
  if (current != null && current > SCHEMA_VERSION) {
    throw new RaceFileError(path.basename(resolved), 'newer')
  }
  if (current != null && current < SCHEMA_VERSION) {
    migrateOnCopy(resolved, dataKey, current)
  }
  const raw = openEncrypted(resolved, dataKey)
  try {
    applyFreshSchema(raw)
    restrictPermissions(resolved)
    return new AppDb(raw, resolved, dataKey)
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

/** Consistent encrypted snapshot. The copy is the encrypted file, written atomically. */
export async function backupDatabase(db: AppDb, dest: string): Promise<void> {
  if (db.filePath === ':memory:' || !db.dataKey) {
    throw new Error('Backup failed: a memory database has no file to copy')
  }
  try {
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    atomicCopyFile(db.filePath, dest)
    restrictPermissions(dest)
  } catch {
    throw new Error('Backup failed')
  }
  try {
    assertBackupIntegrity(dest, db.dataKey)
  } catch (error) {
    fs.rmSync(dest, { force: true })
    throw error
  }
}

export function assertBackupIntegrity(file: string, dataKey?: Buffer): void {
  const key = dataKey ?? resolveDataKey()
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

/** Delete backup files older than the retention period. */
export function pruneBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  if (!fs.existsSync(directory)) return []
  const today = new Date(now).toISOString().slice(0, 10)
  const removed: string[] = []
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.sqlite')) continue
    const full = path.join(directory, name)
    const stat = fs.statSync(full)
    const mtime = new Date(stat.mtimeMs).toISOString().slice(0, 10)
    if (addMonths(mtime, retentionMonths) < today) {
      fs.rmSync(full, { force: true })
      removed.push(full)
    }
  }
  return removed
}
