import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createId } from '@ert/core'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

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
    return data
  }
}

export function openDatabase(filePath: string): AppDb {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  const raw = new Database(filePath)
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = FULL')
  raw.pragma('foreign_keys = ON')
  const existing = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'`).get() as { name: string } | undefined
  if (existing && filePath !== ':memory:') {
    const backup = `${filePath}.premigrate-${Date.now()}.sqlite`
    raw.backup(backup).catch(() => undefined)
  }
  raw.exec(SCHEMA_SQL)
  const meta = raw.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get() as { schema_version: number } | undefined
  if (!meta) {
    raw.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, ?, ?, ?)').run(SCHEMA_VERSION, APP_VERSION, createId())
  } else if (meta.schema_version > SCHEMA_VERSION) {
    throw new Error(`Database schema ${meta.schema_version} is newer than this app (${SCHEMA_VERSION}). Update Easy Race Timer.`)
  }
  return new AppDb(raw, filePath)
}

export function backupDatabase(db: AppDb, dest: string): void {
  if (db.filePath === ':memory:') return
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  db.raw.backup(dest).catch(() => {
    fs.copyFileSync(db.filePath, dest)
  })
}
