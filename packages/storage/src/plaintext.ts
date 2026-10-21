import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { isPlaintextSqlite, openEncrypted, restrictPermissions } from './cipher.js'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error('Plaintext race file has an unsupported table name')
  return `"${name}"`
}

/**
 * Copy a plaintext SQLite file into a new SQLCipher file, wipe the plaintext bytes, and replace it.
 * The file name in errors is the basename only.
 */
export function migratePlaintextFile(filePath: string, dataKey: Buffer): void {
  const base = path.basename(filePath)
  const tmp = path.join(path.dirname(filePath), `.${base}.encrypting`)
  const plain = new Database(filePath, { readonly: true, fileMustExist: true })
  let encrypted: Database.Database | undefined
  try {
    encrypted = openEncrypted(tmp, dataKey)
    const tables = plain.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as { name: string; sql: string | null }[]
    const copy = encrypted.transaction(() => {
      for (const table of tables) {
        if (!table.sql || !IDENT.test(table.name)) throw new Error('Plaintext race file has an unsupported table name')
        encrypted!.exec(table.sql)
        const columns = plain.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all() as { name: string }[]
        const names = columns.map((column) => column.name).filter((name) => IDENT.test(name))
        if (!names.length) continue
        const rows = plain.prepare(`SELECT ${names.map(quoteIdent).join(', ')} FROM ${quoteIdent(table.name)}`).all() as Record<string, unknown>[]
        const insert = encrypted!.prepare(
          `INSERT INTO ${quoteIdent(table.name)} (${names.map(quoteIdent).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        )
        for (const row of rows) insert.run(...names.map((name) => row[name] ?? null))
      }
    })
    copy()
    encrypted.exec('VACUUM')
    encrypted.pragma('wal_checkpoint(TRUNCATE)')
    encrypted.close()
    encrypted = undefined
    plain.close()
    fsyncFile(tmp)
    for (const suffix of ['', '-wal', '-shm']) secureRemove(`${filePath}${suffix}`)
    fs.renameSync(tmp, filePath)
    secureRemove(`${tmp}-wal`)
    secureRemove(`${tmp}-shm`)
    fsyncDirectory(path.dirname(filePath))
    restrictPermissions(filePath)
    console.warn(`Encrypted plaintext race file ${base}. The previous plaintext bytes were overwritten.`)
  } catch (error) {
    try {
      plain.close()
    } catch {
      // The handle may already be closed.
    }
    try {
      encrypted?.close()
    } catch {
      // The handle may already be closed.
    }
    secureRemove(tmp)
    secureRemove(`${tmp}-wal`)
    secureRemove(`${tmp}-shm`)
    if (error instanceof Error && error.message.startsWith('Plaintext race file')) throw error
    throw new Error(`Plaintext race file ${base} could not be encrypted. Archive or delete it, then start again.`)
  }
}

/** Securely delete other plaintext SQLite files in the data directory and in backups/. */
export function removePlaintextCopies(directory: string, keep: string | undefined): string[] {
  const removed: string[] = []
  const roots = [directory]
  const backups = path.join(directory, 'backups')
  if (fs.existsSync(backups)) roots.push(backups)
  const keepResolved = keep ? path.resolve(keep) : undefined
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name)
      if (keepResolved && path.resolve(full) === keepResolved) continue
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      if (!isPlaintextSqlite(full)) continue
      for (const suffix of ['', '-wal', '-shm']) secureRemove(`${full}${suffix}`)
      removed.push(name)
      console.warn(`Removed plaintext SQLite file ${name}. It was not encrypted. Archive a copy before the next start if you still need it.`)
    }
  }
  return removed
}
