import './sqlite-uri.js'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { isPlaintextSqlite, openEncrypted, restrictPermissions, unlock } from './cipher.js'
import { RaceFileError } from './errors.js'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Crash points covered by tests. Production never sets the hooks. */
export type PlaintextStep = 'encrypting' | 'aside' | 'renamed'

/**
 * Test seam. `failAfter` throws once that step is durable.
 * `pauseAfter` writes `READY` and waits so a parent can SIGKILL.
 */
export const plaintextHooks: {
  failAfter?: PlaintextStep
  pauseAfter?: PlaintextStep
} = {}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error('Plaintext race file has an unsupported table name')
  return `"${name}"`
}

function encryptingCandidates(filePath: string): string[] {
  const base = path.basename(filePath)
  return [`${filePath}.encrypting`, path.join(path.dirname(filePath), `.${base}.encrypting`)]
}

function asidePath(filePath: string): string {
  return `${filePath}.plaintext-old`
}

function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    fs.copyFileSync(from, to)
    fsyncFile(to)
    fs.unlinkSync(from)
  }
}

function lstatOrUndefined(file: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(file)
  } catch {
    return undefined
  }
}

function moveWithSidecars(from: string, to: string): void {
  moveFile(from, to)
  for (const suffix of ['-wal', '-shm']) {
    const side = `${from}${suffix}`
    const stat = lstatOrUndefined(side)
    if (!stat || stat.isDirectory()) continue
    moveFile(side, `${to}${suffix}`)
  }
}

/** Retention starts when the file enters quarantine, recorded as its mtime. */
function stampMovedAt(file: string): void {
  const stat = lstatOrUndefined(file)
  if (!stat || stat.isSymbolicLink()) return
  const now = new Date()
  try {
    fs.utimesSync(file, now, now)
  } catch {
    // The filesystem timestamp is the fallback.
  }
}

/** Drop an encrypting leftover this process created. Never used on an unrecognized file. */
function discardEncrypting(filePath: string): void {
  for (const candidate of encryptingCandidates(filePath)) {
    for (const suffix of ['', '-wal', '-shm']) secureRemove(`${candidate}${suffix}`)
  }
}

function afterDurableStep(step: PlaintextStep, directory: string, base: string): void {
  if (plaintextHooks.pauseAfter === step) {
    fs.writeFileSync(path.join(directory, 'READY'), '1')
    const gate = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(gate, 0, 0, 30_000)
  }
  if (plaintextHooks.failAfter === step) {
    throw new Error(`Plaintext race file ${base} paused after ${step}`)
  }
}

type MasterObject = { name: string; sql: string | null }

function copySchemaObjects(plain: Database.Database, encrypted: Database.Database): void {
  const tables = plain.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid`,
  ).all() as { name: string; sql: string | null }[]
  const copy = encrypted.transaction(() => {
    for (const table of tables) {
      if (!table.sql || !IDENT.test(table.name)) throw new Error('Plaintext race file has an unsupported table name')
      encrypted.exec(table.sql)
      const columns = plain.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all() as { name: string }[]
      const names = columns.map((column) => column.name).filter((name) => IDENT.test(name))
      if (!names.length) continue
      const rows = plain.prepare(`SELECT ${names.map(quoteIdent).join(', ')} FROM ${quoteIdent(table.name)}`).all() as Record<string, unknown>[]
      const insert = encrypted.prepare(
        `INSERT INTO ${quoteIdent(table.name)} (${names.map(quoteIdent).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
      )
      for (const row of rows) insert.run(...names.map((name) => row[name] ?? null))
    }
  })
  copy()
  const objects = plain.prepare(
    `SELECT name, sql FROM sqlite_master
     WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY rowid`,
  ).all() as MasterObject[]
  for (const object of objects) {
    if (!object.sql || !IDENT.test(object.name)) throw new Error('Plaintext race file has an unsupported table name')
    encrypted.exec(object.sql)
  }
}

/**
 * Encrypt a plaintext race file without a window where neither copy exists.
 * Order: `<file>.encrypting` (fsync, integrity check), rename the original to
 * `<file>.plaintext-old`, rename the encrypted copy into place, fsync the directory,
 * and only then overwrite the set-aside original where the filesystem allows.
 */
export function migratePlaintextFile(filePath: string, dataKey: Buffer): void {
  const base = path.basename(filePath)
  const directory = path.dirname(filePath)
  const encrypting = `${filePath}.encrypting`
  const aside = asidePath(filePath)
  const plain = new Database(filePath, { readonly: true, fileMustExist: true })
  let encrypted: Database.Database | undefined
  let encryptingDurable = false
  try {
    encrypted = openEncrypted(encrypting, dataKey)
    copySchemaObjects(plain, encrypted)
    encrypted.exec('VACUUM')
    const checkpoint = encrypted.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
    if (checkpoint[0]?.busy) throw new Error(`Plaintext race file ${base} could not be encrypted. Archive or delete it, then start again.`)
    const check = encrypted.pragma('integrity_check', { simple: true })
    if (check !== 'ok') throw new Error(`Plaintext race file ${base} failed integrity check`)
    encrypted.close()
    encrypted = undefined
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${encrypting}${suffix}`, { force: true })
    fsyncFile(encrypting)
    fsyncDirectory(directory)
    encryptingDurable = true
    plain.close()
    afterDurableStep('encrypting', directory, base)

    moveWithSidecars(filePath, aside)
    afterDurableStep('aside', directory, base)

    moveFile(encrypting, filePath)
    fsyncDirectory(directory)
    restrictPermissions(filePath)
    afterDurableStep('renamed', directory, base)

    for (const suffix of ['', '-wal', '-shm']) secureRemove(`${aside}${suffix}`)
    console.warn(`Encrypted plaintext race file ${base}. The previous plaintext bytes were overwritten where the filesystem allows.`)
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
    if (!encryptingDurable) discardEncrypting(filePath)
    if (error instanceof Error && error.message.startsWith('Plaintext race file')) throw error
    throw new Error(`Plaintext race file ${base} could not be encrypted. Archive or delete it, then start again.`)
  }
}

function encryptedIntegrityOk(file: string, dataKey: Buffer): boolean {
  if (!fs.existsSync(file) || isPlaintextSqlite(file)) return false
  const hadWal = fs.existsSync(`${file}-wal`) || fs.existsSync(`${file}-shm`)
  let raw: Database.Database | undefined
  try {
    raw = new Database(file, { readonly: true, fileMustExist: true })
    unlock(raw, dataKey)
    return raw.pragma('integrity_check', { simple: true }) === 'ok'
  } catch {
    return false
  } finally {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
    if (!hadWal) {
      fs.rmSync(`${file}-wal`, { force: true })
      fs.rmSync(`${file}-shm`, { force: true })
    }
  }
}

function restoreAside(filePath: string): void {
  const aside = asidePath(filePath)
  if (!fs.existsSync(filePath) && fs.existsSync(aside)) moveFile(aside, filePath)
  for (const suffix of ['-wal', '-shm']) {
    const from = `${aside}${suffix}`
    const to = `${filePath}${suffix}`
    if (fs.existsSync(from) && !fs.existsSync(to)) moveFile(from, to)
  }
  fsyncDirectory(path.dirname(filePath))
}

function replaceTargetWithAside(filePath: string): void {
  const rejected = `${filePath}.rejected`
  moveWithSidecars(filePath, rejected)
  try {
    restoreAside(filePath)
  } catch (error) {
    if (!fs.existsSync(filePath) && fs.existsSync(rejected)) moveWithSidecars(rejected, filePath)
    throw error
  }
  for (const suffix of ['', '-wal', '-shm']) secureRemove(`${rejected}${suffix}`)
}

/**
 * Finish or undo a plaintext migration that stopped between steps.
 * A set-aside plaintext original wins when the encrypted target is missing or fails its integrity check.
 */
export function recoverPlaintextMigration(filePath: string, dataKey: Buffer): void {
  const base = path.basename(filePath)
  const aside = asidePath(filePath)
  const targetExists = fs.existsSync(filePath)
  const asideExists = fs.existsSync(aside)
  const validEncrypting = encryptingCandidates(filePath).find((candidate) => encryptedIntegrityOk(candidate, dataKey))
  const anyEncrypting = encryptingCandidates(filePath).some((candidate) => fs.existsSync(candidate))

  if (!targetExists && asideExists) {
    restoreAside(filePath)
    discardEncrypting(filePath)
    return
  }
  if (!targetExists && validEncrypting) {
    moveWithSidecars(validEncrypting, filePath)
    fsyncDirectory(path.dirname(filePath))
    restrictPermissions(filePath)
    discardEncrypting(filePath)
    return
  }
  if (!targetExists && anyEncrypting) {
    throw new RaceFileError(base, 'open')
  }
  if (targetExists && isPlaintextSqlite(filePath)) {
    if (anyEncrypting) discardEncrypting(filePath)
    return
  }
  if (targetExists && asideExists) {
    if (encryptedIntegrityOk(filePath, dataKey)) {
      for (const suffix of ['', '-wal', '-shm']) secureRemove(`${aside}${suffix}`)
      console.warn(`Removed leftover plaintext race file ${path.basename(aside)}. The bytes were overwritten where the filesystem allows.`)
      return
    }
    replaceTargetWithAside(filePath)
    discardEncrypting(filePath)
  }
}

/** True when the basename is one this app creates. The directory is one level only. */
export function isRecognizedRaceFileName(name: string, inBackups: boolean): boolean {
  const database = name.endsWith('.bak') ? name.slice(0, -'.bak'.length) : name
  if (inBackups) {
    if (/^ert-.+\.sqlite$/.test(database)) return true
  } else if (/^ert.*\.sqlite$/.test(database)) return true
  if (/\.premigrate(?:-.+)?\.sqlite$/.test(database)) return true
  if (/\.sqlite\.v\d+\.bak$/.test(name)) return true
  return false
}

/**
 * Read-only URI for the original file. `immutable=1` does not create `-wal` or `-shm`.
 * The SQLCipher binding opens this with no key. A plaintext file is readable that way.
 */
export function immutableReadUri(file: string): string {
  const absolute = path.resolve(file)
  const slash = process.platform === 'win32' ? absolute.replaceAll('\\', '/') : absolute
  const encoded = slash.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `file:${encoded}?mode=ro&immutable=1`
}

function hasSchemaMeta(file: string): boolean {
  let raw: Database.Database | undefined
  try {
    raw = new Database(immutableReadUri(file), { readonly: true, fileMustExist: true })
    const row = raw.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta' LIMIT 1`).get()
    return Boolean(row)
  } catch {
    return false
  } finally {
    try {
      raw?.close()
    } catch {
      // The handle may already be closed.
    }
  }
}

function quarantineDirectory(dataDir: string): string {
  const quarantine = path.join(dataDir, 'plaintext-quarantine')
  fs.mkdirSync(quarantine, { recursive: true })
  try {
    fs.chmodSync(quarantine, 0o700)
  } catch {
    // Permissions are best-effort on filesystems that ignore them.
  }
  return quarantine
}

/**
 * Move recognized plaintext race files into `plaintext-quarantine/`.
 * Unrecognized files, including another program's database, are not opened and not moved.
 * Returns the basenames that were moved. Nothing here is deleted.
 */
export function quarantinePlaintextCopies(directory: string, keep: string | undefined): string[] {
  const moved: string[] = []
  const roots = [directory]
  const backups = path.join(directory, 'backups')
  const backupStat = lstatOrUndefined(backups)
  if (backupStat?.isDirectory() && !backupStat.isSymbolicLink()) roots.push(backups)
  const keepResolved = keep ? path.resolve(keep) : undefined
  for (const root of roots) {
    const rootStat = lstatOrUndefined(root)
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue
    const inBackups = path.resolve(root) === path.resolve(backups)
    for (const name of fs.readdirSync(root)) {
      if (name === 'plaintext-quarantine' || name === 'backups') continue
      if (!isRecognizedRaceFileName(name, inBackups)) continue
      const full = path.join(root, name)
      if (keepResolved && path.resolve(full) === keepResolved) continue
      const stat = lstatOrUndefined(full)
      if (!stat || stat.isSymbolicLink() || !stat.isFile()) continue
      if (!isPlaintextSqlite(full)) continue
      if (!hasSchemaMeta(full)) continue
      const quarantine = quarantineDirectory(directory)
      let dest = path.join(quarantine, name)
      if (lstatOrUndefined(dest)) dest = path.join(quarantine, `${name}.${Date.now()}`)
      moveWithSidecars(full, dest)
      stampMovedAt(dest)
      for (const suffix of ['-wal', '-shm']) stampMovedAt(`${dest}${suffix}`)
      moved.push(name)
      console.warn(`Quarantined plaintext race file ${name}. It is in plaintext-quarantine and was not deleted.`)
    }
  }
  return moved
}

export const QUARANTINE_DIR_NAME = 'plaintext-quarantine'
/** Quarantined plaintext is removed at startup once it is this old. */
export const QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function quarantinePath(dataDir: string): string {
  return path.join(dataDir, QUARANTINE_DIR_NAME)
}

function dataDirOf(databasePath: string): string | undefined {
  if (!databasePath || databasePath === ':memory:') return undefined
  return path.dirname(path.resolve(databasePath))
}

/** True when plaintext-quarantine/ contains a file or a symlink. Empty after a restart still counts. */
export function plaintextQuarantinePending(databasePath: string): boolean {
  const dataDir = dataDirOf(databasePath)
  if (!dataDir) return false
  const dir = quarantinePath(dataDir)
  const dirStat = lstatOrUndefined(dir)
  if (!dirStat || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false
  for (const name of fs.readdirSync(dir)) {
    const stat = lstatOrUndefined(path.join(dir, name))
    if (!stat || stat.isDirectory()) continue
    return true
  }
  return false
}

function removeQuarantineEntry(full: string): void {
  const stat = lstatOrUndefined(full)
  if (!stat || stat.isDirectory()) return
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(full)
    return
  }
  secureRemove(full)
}

/**
 * Overwrite quarantined files where the filesystem allows, unlink them, and fsync the directory.
 * Symlinks are unlinked and not followed. Returns basenames only.
 */
export function deleteQuarantinedPlaintext(databasePath: string): string[] {
  const dataDir = dataDirOf(databasePath)
  if (!dataDir) return []
  const dir = quarantinePath(dataDir)
  const dirStat = lstatOrUndefined(dir)
  if (!dirStat || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return []
  const removed: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = lstatOrUndefined(full)
    if (!stat || stat.isDirectory()) continue
    removeQuarantineEntry(full)
    removed.push(name)
    console.warn(`Removed quarantined plaintext race file ${name}. The bytes were overwritten where the filesystem allows.`)
  }
  if (removed.length) fsyncDirectory(dir)
  return removed
}

/** Drop quarantined files whose mtime is older than the retention window. Checked at startup. */
export function purgeExpiredQuarantine(dataDir: string, nowMs = Date.now(), retentionMs = QUARANTINE_RETENTION_MS): string[] {
  const dir = quarantinePath(dataDir)
  const dirStat = lstatOrUndefined(dir)
  if (!dirStat || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return []
  const removed: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = lstatOrUndefined(full)
    if (!stat || stat.isDirectory()) continue
    if (nowMs - stat.mtimeMs < retentionMs) continue
    removeQuarantineEntry(full)
    removed.push(name)
    console.warn(`Removed quarantined plaintext race file ${name}. It was older than the retention period. The bytes were overwritten where the filesystem allows.`)
  }
  if (removed.length) fsyncDirectory(dir)
  return removed
}
