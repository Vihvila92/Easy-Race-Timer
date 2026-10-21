// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { addMonths, createId } from '@ert/core'
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

export const APP_VERSION = '0.1.0'
export const ORG_ID = 'local'

export type Row = Record<string, unknown>

export class AppDb {
  constructor(readonly raw: Database.Database, readonly filePath: string) {}

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
    return data
  }
}

/**
 * Open the race database. An existing file whose schema is older than this
 * build is backed up with the SQLite backup API before any migration runs.
 * A failed backup aborts startup and leaves the file untouched.
 */
export async function openDatabase(filePath: string): Promise<AppDb> {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  const raw = new Database(filePath)
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = FULL')
  raw.pragma('foreign_keys = ON')
  const existing = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`).get() as { name: string } | undefined
  const current = existing
    ? (raw.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get() as { schema_version: number } | undefined)?.schema_version
    : undefined
  if (current != null && current > SCHEMA_VERSION) {
    raw.close()
    throw new Error(`Database schema ${current} is newer than this app (${SCHEMA_VERSION}). Update Easy Race Timer.`)
  }
  const needsMigration = current != null && current < SCHEMA_VERSION
  if (needsMigration && filePath !== ':memory:') {
    const backup = `${filePath}.premigrate-${Date.now()}.sqlite`
    try {
      await backupDatabase(new AppDb(raw, filePath), backup)
    } catch (error) {
      raw.close()
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Pre-migration backup failed; migration was not started. ${detail}`)
    }
  }
  raw.exec(SCHEMA_SQL)
  if (current == null) {
    raw.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, ?, ?, ?)').run(SCHEMA_VERSION, APP_VERSION, createId())
  } else if (needsMigration) {
    for (const migration of MIGRATIONS) {
      if (migration.version > current && migration.version <= SCHEMA_VERSION) migration.up(raw)
    }
    raw.prepare('UPDATE schema_meta SET schema_version = ?, app_version = ? WHERE id = 1').run(SCHEMA_VERSION, APP_VERSION)
  }
  return new AppDb(raw, filePath)
}

/** Consistent snapshot via the SQLite backup API. Rejects unless integrity_check is ok. */
export async function backupDatabase(db: AppDb, dest: string): Promise<void> {
  if (db.filePath === ':memory:') {
    throw new Error('Backup failed: a memory database has no file to copy')
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    await db.raw.backup(dest)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Backup failed: ${detail}`)
  }
  try {
    assertBackupIntegrity(dest)
  } catch (error) {
    fs.rmSync(dest, { force: true })
    throw error
  }
  try {
    fs.chmodSync(dest, 0o600)
  } catch {
    // Permissions are best-effort on filesystems that ignore them.
  }
}

export function assertBackupIntegrity(file: string): void {
  const raw = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const result = raw.pragma('integrity_check', { simple: true })
    if (result !== 'ok') {
      throw new Error(`Backup integrity check failed: ${String(result)}`)
    }
  } finally {
    raw.close()
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
