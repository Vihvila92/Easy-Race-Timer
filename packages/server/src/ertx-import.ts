import { z } from 'zod'
import { AppError } from '@ert/core'
import { SCHEMA_VERSION, type AppDb } from '@ert/storage'
import { ERTX_FORMAT_VERSION, ErtxError, unpackErtx, type ErtxManifest } from '@ert/sync'

/** Tables an .ertx archive may replace, in insert order. Names are constants, never archive text. */
export const ERTX_TABLES = [
  'event',
  'race',
  'category',
  'person',
  'club',
  'club_alias',
  'consent',
  'entry',
  'timing_point',
  'device',
  'timing_event',
  'correction',
  'tie_resolution',
] as const

export type ErtxTable = (typeof ERTX_TABLES)[number]

const TABLE_SET = new Set<string>(ERTX_TABLES)
const DENIED_COLUMNS = new Set(['pin_hash'])
const IDENT = /^[a-z_]+$/

const cell = z.union([z.string(), z.number(), z.null()])

export interface ParsedErtx {
  manifest: ErtxManifest
  tables: { table: ErtxTable; rows: Record<string, string | number | null>[] }[]
}

export interface ErtxPreview {
  preview: true
  format_version: number
  schema_version: number
  app_version: string
  tables: Record<string, number>
}

function fail(message: string): never {
  throw new AppError('VALIDATION_ERROR', message)
}

function columnsFor(db: AppDb, table: ErtxTable): string[] {
  const info = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
  return info.map((row) => row.name).filter((name) => IDENT.test(name) && !DENIED_COLUMNS.has(name))
}

function assertManifest(manifest: ErtxManifest) {
  if (manifest.format_version !== ERTX_FORMAT_VERSION) {
    fail(`Unsupported .ertx format ${String(manifest.format_version)}`)
  }
  if (!Number.isInteger(manifest.schema_version) || manifest.schema_version < 1 || manifest.schema_version > SCHEMA_VERSION) {
    fail(`Unsupported schema version ${String(manifest.schema_version)}`)
  }
  if (typeof manifest.app_version !== 'string' || manifest.app_version.trim() === '') {
    fail('Archive is missing app_version')
  }
}

function parseTables(db: AppDb, data: unknown): ParsedErtx['tables'] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Archive data must be an object')
  const record = data as Record<string, unknown>
  for (const table of Object.keys(record)) {
    if (table === 'schema_meta') continue
    if (!TABLE_SET.has(table)) fail(`Table ${table} is not allowed`)
  }
  const parsed: ParsedErtx['tables'] = []
  for (const table of ERTX_TABLES) {
    const raw = record[table]
    if (raw == null) continue
    if (!Array.isArray(raw)) fail(`Table ${table} must be an array`)
    const allowed = columnsFor(db, table)
    const allowedSet = new Set(allowed)
    const shape: Record<string, z.ZodType> = {}
    for (const column of allowed) shape[column] = cell.optional()
    const rowSchema = z.strictObject(shape)
    const rows: Record<string, string | number | null>[] = []
    for (const row of raw) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`Row in ${table} is not an object`)
      for (const key of Object.keys(row)) {
        if (!allowedSet.has(key)) fail(`Column ${table}.${key} is not allowed`)
      }
      const checked = rowSchema.safeParse(row)
      if (!checked.success) fail(`Row in ${table} failed validation`)
      rows.push(checked.data as Record<string, string | number | null>)
    }
    parsed.push({ table, rows })
  }
  return parsed
}

export async function readErtx(db: AppDb, bytes: Uint8Array): Promise<ParsedErtx> {
  const unpacked = await unpackErtx(bytes).catch((error: unknown) => {
    throw new AppError('VALIDATION_ERROR', error instanceof ErtxError ? error.message : 'Could not read archive')
  })
  assertManifest(unpacked.manifest)
  return { manifest: unpacked.manifest, tables: parseTables(db, unpacked.data) }
}

export function previewErtx(parsed: ParsedErtx): ErtxPreview {
  const tables: Record<string, number> = {}
  for (const table of ERTX_TABLES) tables[table] = 0
  for (const entry of parsed.tables) tables[entry.table] = entry.rows.length
  return {
    preview: true,
    format_version: parsed.manifest.format_version,
    schema_version: parsed.manifest.schema_version,
    app_version: parsed.manifest.app_version,
    tables,
  }
}

/**
 * Replace allowlisted tables. Column names in SQL come only from PRAGMA table_info.
 * The caller restores pin_hash and writes the audit row inside the same transaction.
 */
export function replaceFromErtx(db: AppDb, parsed: ParsedErtx) {
  const columns = new Map(ERTX_TABLES.map((table) => [table, columnsFor(db, table)]))
  for (const table of [...ERTX_TABLES].reverse()) db.run(`DELETE FROM ${table}`)
  for (const entry of parsed.tables) {
    const allowed = columns.get(entry.table) ?? []
    for (const row of entry.rows) {
      const keys = allowed.filter((column) => Object.prototype.hasOwnProperty.call(row, column))
      if (!keys.length) continue
      db.run(
        `INSERT INTO ${entry.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        ...keys.map((column) => row[column]),
      )
    }
  }
}
