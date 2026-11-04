// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { atomicCopyFile, fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { openEncrypted, rawKeyPragma, restrictPermissions, type SqliteDatabase } from './cipher.js'
import { RaceFileError } from './errors.js'
import { devKeyOptIn, isDevDataKey } from './key.js'
import { backupPairComplete, keyFilePath, rekeyTempPaths } from './key-file.js'
import { rekeyHooks, zeroKeyOnClose, type AppDb, type RekeyOptions } from './db.js'

function adoptConnection(db: AppDb, raw: SqliteDatabase): void {
  ;(db as { raw: SqliteDatabase }).raw = raw
}

function assertRekeyInput(db: AppDb, newKey: Buffer): void {
  if (db.filePath === ':memory:' || !db.dataKey) throw new Error('A memory database has no data key to rotate')
  if (newKey.length !== 32) throw new Error('Data key must be 32 bytes')
  if (isDevDataKey(newKey) && !devKeyOptIn()) {
    throw new RaceFileError('', process.env.NODE_ENV === 'production' ? 'dev-key' : 'missing-key')
  }
}

function phase(name: Parameters<NonNullable<typeof rekeyHooks.onPhase>>[0], file: string, journal?: string): void {
  rekeyHooks.onPhase?.(name, journal === undefined ? { file } : { file, journal })
}

function rekeyOpenCopy(input: { db: AppDb; previous: Buffer; incoming: Buffer; database: string; prepareCopy?: (copy: SqliteDatabase) => void }): void {
  const { db, previous, incoming, database, prepareCopy } = input
  db.raw.pragma('wal_checkpoint(TRUNCATE)')
  phase('checkpoint-before-copy', db.filePath)
  atomicCopyFile(db.filePath, database)
  const copy = openEncrypted(database, previous)
  try {
    copy.pragma('journal_mode = DELETE')
    phase('journal-delete', database, String(copy.pragma('journal_mode', { simple: true })))
    phase('before-rekey', database, 'delete')
    prepareCopy?.(copy)
    copy.pragma(rawKeyPragma('rekey', incoming))
    phase('rekey', database)
    if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Rekey integrity check failed')
    phase('integrity-ok', database)
    copy.pragma('journal_mode = WAL')
    phase('journal-wal', database, String(copy.pragma('journal_mode', { simple: true })))
  } finally {
    copy.close()
  }
}

function checkpointRekeyedCopy(database: string, incoming: Buffer): void {
  const settled = openEncrypted(database, incoming)
  try {
    settled.pragma('wal_checkpoint(TRUNCATE)')
    phase('checkpoint-after-rekey', database)
  } finally {
    settled.close()
  }
  fsyncFile(database)
  secureRemove(`${database}-wal`)
  secureRemove(`${database}-shm`)
}

function writeRekeyKey(db: AppDb, tempKey: string, writeKeyFile?: (tempKeyPath: string) => void): void {
  if (!backupPairComplete(db.filePath)) throw new Error('Rekey failed')
  if (writeKeyFile) writeKeyFile(tempKey)
  else atomicCopyFile(keyFilePath(db.filePath), tempKey)
  fsyncFile(tempKey)
}

function reopenRekeyed(db: AppDb, key: Buffer): void {
  const next = openEncrypted(db.filePath, key)
  zeroKeyOnClose(next, key)
  adoptConnection(db, next)
}

function restoreClosed(db: AppDb, key: Buffer): void {
  if (db.raw.open) return
  key.copy(db.dataKey!)
  reopenRekeyed(db, db.dataKey!)
}

function rollbackRekey(input: { db: AppDb; temps: { database: string; key: string }; renamed: boolean; closed: boolean; previous: Buffer; incoming: Buffer }): void {
  const { db, temps, renamed, closed, previous, incoming } = input
  if (renamed) {
    restoreClosed(db, incoming)
    return
  }
  secureRemove(temps.database)
  secureRemove(`${temps.database}-wal`)
  secureRemove(`${temps.database}-shm`)
  secureRemove(temps.key)
  if (closed) restoreClosed(db, previous)
}

function rethrowRekey(error: unknown): never {
  if (error instanceof RaceFileError) throw error
  if (error instanceof Error && error.message === 'Rekey integrity check failed') throw error
  throw new Error('Rekey failed')
}

/** Rotate the data key on a copy. The live file is not rekeyed in place. */
export function rekeyDataFile(db: AppDb, newKey: Buffer, options: RekeyOptions = {}): void {
  assertRekeyInput(db, newKey)
  const previous = Buffer.from(db.dataKey!)
  const incoming = Buffer.from(newKey)
  const temps = rekeyTempPaths(db.filePath)
  let renamed = false
  let closed = false
  try {
    rekeyOpenCopy({ db, previous, incoming, database: temps.database, prepareCopy: options.prepareCopy })
    checkpointRekeyedCopy(temps.database, incoming)
    writeRekeyKey(db, temps.key, options.writeKeyFile)
    rekeyHooks.beforeRename?.()
    db.raw.close()
    closed = true
    fs.renameSync(temps.database, db.filePath)
    renamed = true
    fsyncDirectory(path.dirname(db.filePath))
    rekeyHooks.afterDatabaseRename?.()
    fs.renameSync(temps.key, keyFilePath(db.filePath))
    fsyncDirectory(path.dirname(db.filePath))
    restrictPermissions(db.filePath)
    incoming.copy(db.dataKey!)
    reopenRekeyed(db, db.dataKey!)
  } catch (error) {
    rollbackRekey({ db, temps, renamed, closed, previous, incoming })
    rethrowRekey(error)
  } finally {
    incoming.fill(0)
    previous.fill(0)
  }
}
