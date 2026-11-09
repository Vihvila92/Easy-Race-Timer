// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { atomicCopyFile, fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { openEncrypted, rawKeyPragma, restrictPermissions, type SqliteDatabase } from './cipher.js'
import type { AppDb } from './db.js'
import { RaceFileError } from './errors.js'
import { backupPairComplete, inspectKeyFile, keyFilePath, rekeyTempPaths } from './key-file.js'
import { devKeyOptIn, isDevDataKey } from './key.js'
import { ensureFileId } from './schema.js'

/** Test seam. Production never sets this. A throw leaves the original pair in place. */
export const rekeyHooks: {
  beforeRename?: () => void
} = {}

interface KeyTemps {
  database: string
  key: string
}

function zeroKeyOnClose(raw: SqliteDatabase, dataKey: Buffer): void {
  const close = raw.close.bind(raw)
  raw.close = () => {
    const result = close()
    dataKey.fill(0)
    return result
  }
}

function adoptConnection(db: AppDb, raw: SqliteDatabase, dataKey: Buffer): void {
  zeroKeyOnClose(raw, dataKey)
  ;(db as { raw: SqliteDatabase }).raw = raw
}

function reopen(db: AppDb, key: Buffer): void {
  key.copy(db.dataKey!)
  adoptConnection(db, openEncrypted(db.filePath, db.dataKey!), db.dataKey!)
}

function rekeyCopy(database: string, previous: Buffer, incoming: Buffer): void {
  const copy = openEncrypted(database, previous)
  try {
    copy.pragma('journal_mode = DELETE')
    copy.pragma(rawKeyPragma('rekey', incoming))
    const result = copy.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error('Rekey integrity check failed')
    copy.pragma('journal_mode = WAL')
  } finally {
    copy.close()
  }
  const settled = openEncrypted(database, incoming)
  try {
    settled.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    settled.close()
  }
  fsyncFile(database)
  secureRemove(`${database}-wal`)
  secureRemove(`${database}-shm`)
}

function prepareRekeyCopy(db: AppDb, previous: Buffer, incoming: Buffer): void {
  const temps = rekeyTempPaths(db.filePath)
  db.raw.pragma('wal_checkpoint(TRUNCATE)')
  atomicCopyFile(db.filePath, temps.database)
  rekeyCopy(temps.database, previous, incoming)
  if (!backupPairComplete(db.filePath)) throw new Error('Rekey failed')
  atomicCopyFile(keyFilePath(db.filePath), temps.key)
  fsyncFile(temps.key)
}

function discardRekeyTemps(temps: KeyTemps): void {
  secureRemove(temps.database)
  secureRemove(`${temps.database}-wal`)
  secureRemove(`${temps.database}-shm`)
  secureRemove(temps.key)
}

function failRekey(error: unknown): never {
  if (error instanceof RaceFileError) throw error
  if (error instanceof Error && error.message === 'Rekey integrity check failed') throw error
  throw new Error('Rekey failed')
}

function assertCanRekey(db: AppDb, newKey: Buffer): void {
  if (db.filePath === ':memory:' || !db.dataKey) throw new Error('A memory database has no data key to rotate')
  if (newKey.length !== 32) throw new Error('Data key must be 32 bytes')
  if (isDevDataKey(newKey) && !devKeyOptIn()) throw new RaceFileError('', process.env.NODE_ENV === 'production' ? 'dev-key' : 'missing-key')
}

function commitRekey(db: AppDb, temps: KeyTemps, incoming: Buffer): void {
  const directory = path.dirname(db.filePath)
  rekeyHooks.beforeRename?.()
  db.raw.close()
  fs.renameSync(temps.database, db.filePath)
  fsyncDirectory(directory)
  fs.renameSync(temps.key, keyFilePath(db.filePath))
  fsyncDirectory(directory)
  restrictPermissions(db.filePath)
  reopen(db, incoming)
}

function cleanupRekey(db: AppDb, temps: KeyTemps, keys: { previous: Buffer; incoming: Buffer }, error: unknown): never {
  const renamed = !fs.existsSync(temps.database) && fs.existsSync(db.filePath)
  if (!renamed) {
    discardRekeyTemps(temps)
    if (!db.raw.open) reopen(db, keys.previous)
  } else if (!db.raw.open) reopen(db, keys.incoming)
  failRekey(error)
}

/**
 * Rotate the data key on a copy. The live connection is not rekeyed in place.
 * SQLite3 Multiple Ciphers cannot rekey a database that is in WAL mode, so the
 * copy is switched to DELETE for the rekey and back to WAL after integrity_check.
 * The key stub is copied unchanged. #131 writes the new envelope at that step.
 */
export function rekeyDataFile(db: AppDb, newKey: Buffer): void {
  assertCanRekey(db, newKey)
  const previous = Buffer.from(db.dataKey!)
  const incoming = Buffer.from(newKey)
  const temps = rekeyTempPaths(db.filePath)
  try {
    prepareRekeyCopy(db, previous, incoming)
    commitRekey(db, temps, incoming)
  } catch (error) {
    cleanupRekey(db, temps, { previous, incoming }, error)
  } finally {
    incoming.fill(0)
    previous.fill(0)
  }
}

function keyTempMatches(filePath: string, dataKey: Buffer, keyTemp: string): boolean {
  const raw = openEncrypted(filePath, dataKey)
  try {
    const info = inspectKeyFile(keyTemp)
    const fileId = ensureFileId(raw)
    return (info.kind === 'stub' || info.kind === 'envelope') && info.fileId === fileId
  } finally {
    raw.close()
  }
}

function attachKeyTemp(filePath: string, dataKey: Buffer, keyTemp: string): void {
  let matches = false
  try {
    matches = keyTempMatches(filePath, dataKey, keyTemp)
  } catch (error) {
    if (error instanceof RaceFileError) throw error
    throw new Error(`Key file recovery failed for ${path.basename(filePath)}.`)
  }
  if (!matches) throw new Error(`Key file recovery failed for ${path.basename(filePath)}.`)
  fs.renameSync(keyTemp, keyFilePath(filePath))
  fsyncDirectory(path.dirname(filePath))
  restrictPermissions(keyFilePath(filePath))
}

/**
 * A database temp means the rename did not happen, so the original pair is kept.
 * A key temp alone is the crash window after the database rename. It is attached
 * only when its file id matches. Otherwise both files stay and open fails closed.
 */
export function recoverRekeyTemps(filePath: string, dataKey: Buffer): void {
  const temps = rekeyTempPaths(filePath)
  if (fs.existsSync(temps.database)) {
    if (fs.existsSync(filePath)) discardRekeyTemps(temps)
    return
  }
  if (!fs.existsSync(temps.key) || !fs.existsSync(filePath)) return
  attachKeyTemp(filePath, dataKey, temps.key)
}
