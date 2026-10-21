import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { RaceFileError } from './errors.js'

export type SqliteDatabase = Database.Database

/** Unencrypted SQLite header. An encrypted race file must not contain these bytes. */
export const SQLITE_PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0')

/**
 * SQLCipher 4 defaults, pinned.
 * `legacy = 4` selects AES-256, 4096-byte pages, PBKDF2-HMAC-SHA512, HMAC-SHA512 and HMAC on.
 * Parameters after `legacy` keep those values if a library default changes.
 * `kdf_algorithm` and `hmac_algorithm` value 2 is SHA-512 in SQLite3 Multiple Ciphers.
 */
export const CIPHER_STATEMENTS = [
  "cipher = 'sqlcipher'",
  'legacy = 4',
  'legacy_page_size = 4096',
  'kdf_iter = 256000',
  'hmac_use = 1',
  'kdf_algorithm = 2',
  'hmac_algorithm = 2',
  'plaintext_header_size = 0',
] as const

export const EXPECTED_CIPHER = {
  cipher: 'sqlcipher',
  legacy: '4',
  legacy_page_size: '4096',
  kdf_iter: '256000',
  hmac_use: '1',
  kdf_algorithm: '2',
  hmac_algorithm: '2',
  plaintext_header_size: '0',
} as const

export function cipherSettings(raw: SqliteDatabase): Record<keyof typeof EXPECTED_CIPHER, string> {
  const settings = {} as Record<keyof typeof EXPECTED_CIPHER, string>
  for (const name of Object.keys(EXPECTED_CIPHER) as (keyof typeof EXPECTED_CIPHER)[]) {
    settings[name] = String(raw.pragma(name, { simple: true }))
  }
  return settings
}

function keyStatement(dataKey: Buffer): string {
  return `key = "x'${dataKey.toString('hex')}'"`
}

/** Cipher parameters and the raw 256-bit key. Does not change journal settings. */
export function unlock(raw: SqliteDatabase, dataKey: Buffer): void {
  if (dataKey.length !== 32) throw new Error('Data key must be 32 bytes')
  for (const statement of CIPHER_STATEMENTS) raw.pragma(statement)
  raw.pragma(keyStatement(dataKey))
  raw.prepare('SELECT count(*) AS n FROM sqlite_master').get()
}

/** Unlock, then the runtime pragmas for a database this process will write. */
export function applyCipher(raw: SqliteDatabase, dataKey: Buffer): void {
  unlock(raw, dataKey)
  raw.pragma('temp_store = MEMORY')
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = FULL')
  raw.pragma('foreign_keys = ON')
}

export function restrictPermissions(filePath: string): void {
  if (filePath === ':memory:') return
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${filePath}${suffix}`
    if (!fs.existsSync(candidate)) continue
    try {
      fs.chmodSync(candidate, 0o600)
    } catch {
      // Permissions are best-effort on filesystems that ignore them.
    }
  }
}

export function openEncrypted(filePath: string, dataKey: Buffer): SqliteDatabase {
  let raw: SqliteDatabase | undefined
  try {
    raw = new Database(filePath)
    applyCipher(raw, dataKey)
    restrictPermissions(filePath)
    return raw
  } catch (error) {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
    if (error instanceof RaceFileError) throw error
    throw new RaceFileError(path.basename(filePath), 'open')
  }
}

/** Read the schema version without writing. A wrong key or a damaged file throws RaceFileError. */
export function peekSchemaVersion(filePath: string, dataKey: Buffer): number | undefined {
  let raw: SqliteDatabase | undefined
  try {
    raw = new Database(filePath, { readonly: true, fileMustExist: true })
    unlock(raw, dataKey)
    const existing = raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'`).get() as { name: string } | undefined
    if (!existing) return undefined
    const row = raw.prepare('SELECT schema_version FROM schema_meta WHERE id = 1').get() as { schema_version: number } | undefined
    return row?.schema_version
  } catch (error) {
    if (error instanceof RaceFileError) throw error
    throw new RaceFileError(path.basename(filePath), 'open')
  } finally {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
  }
}

export function plaintextSqliteFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  const found: string[] = []
  for (const name of fs.readdirSync(directory)) {
    const full = path.join(directory, name)
    const stat = fs.statSync(full)
    if (!stat.isFile()) continue
    const data = fs.readFileSync(full)
    if (data.includes(SQLITE_PLAINTEXT_HEADER)) found.push(name)
  }
  return found
}
