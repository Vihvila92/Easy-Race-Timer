// SPDX-License-Identifier: AGPL-3.0-only
import './sqlite-uri.js'
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
 * `plaintext_header_size = 0` keeps the SQLCipher salt at offset 0. There is no custom file header.
 * SQLCipher 4 already stores a random 16-byte IV per page and an HMAC-SHA512 over the page. Those are not changed.
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

/**
 * SQLCipher raw-key pragma, `key` or `rekey`.
 *
 * The text is `name = "x'<hex>'"`. `<hex>` is exactly `dataKey.toString('hex')`:
 * 64 lowercase hex digits, and nothing else is concatenated. Callers pass a Buffer.
 * This function is the only place that builds the statement. SQL tracing is not enabled,
 * so the statement is not written to a log.
 *
 * `Database#key(Buffer)` and `Database#rekey(Buffer)` are not used. This binding treats
 * those bytes as a passphrase. The `x'hex'` form is SQLCipher's raw-key syntax and does
 * not run the passphrase KDF on top of the 32 bytes.
 */
export function rawKeyPragma(name: 'key' | 'rekey', dataKey: Buffer): string {
  if (dataKey.length !== 32) throw new Error('Data key must be 32 bytes')
  return `${name} = "x'${dataKey.toString('hex')}'"`
}

/** Cipher parameters and the raw 256-bit key. Does not change journal settings. */
export function unlock(raw: SqliteDatabase, dataKey: Buffer): void {
  if (dataKey.length !== 32) throw new Error('Data key must be 32 bytes')
  for (const statement of CIPHER_STATEMENTS) raw.pragma(statement)
  raw.pragma(rawKeyPragma('key', dataKey))
  raw.prepare('SELECT count(*) AS n FROM sqlite_master').get()
}

/** Unlock, then the runtime pragmas for a database this process will write. */
export function applyCipher(raw: SqliteDatabase, dataKey: Buffer): void {
  unlock(raw, dataKey)
  raw.pragma('secure_delete = ON')
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

/** Plaintext SQLite file, no key and no cipher pragmas. Not used for the race file. */
export function openPlaintextSqlite(filePath: string): SqliteDatabase {
  return new Database(filePath)
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

export function isPlaintextSqlite(file: string): boolean {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const header = Buffer.alloc(SQLITE_PLAINTEXT_HEADER.length)
    const read = fs.readSync(fd, header, 0, header.length, 0)
    return read === header.length && header.equals(SQLITE_PLAINTEXT_HEADER)
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
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
