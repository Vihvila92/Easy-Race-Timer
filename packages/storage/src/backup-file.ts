// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { atomicCopyFile, fsyncDirectory, secureRemove } from './atomic.js'
import { openEncrypted, restrictPermissions, type SqliteDatabase } from './cipher.js'
import type { AppDb } from './db.js'
import { RaceFileError } from './errors.js'
import { backupPairComplete, ensureKeyFile, keyFilePath } from './key-file.js'
import { ensureFileId } from './schema.js'

/** Test seam. Production never sets this. A throw stops the restore after that step. */
export const restoreHooks: { crashAt?: 'prepared' | 'prev' | 'database' | 'keys' } = {}

interface RestoreSet {
  dest: string
  key: string
  wal: string
  shm: string
  prev: string
  prevKey: string
  prevWal: string
  prevShm: string
  restore: string
  restoreKey: string
}

function crash(step: NonNullable<typeof restoreHooks.crashAt>): void {
  if (restoreHooks.crashAt === step) throw new Error(`crash at ${step}`)
}

function restoreSet(dest: string): RestoreSet {
  const restore = path.join(path.dirname(dest), `.${path.basename(dest)}.restore`)
  const key = keyFilePath(dest)
  return {
    dest,
    key,
    wal: `${dest}-wal`,
    shm: `${dest}-shm`,
    prev: `${dest}.prev`,
    prevKey: `${key}.prev`,
    prevWal: `${dest}-wal.prev`,
    prevShm: `${dest}-shm.prev`,
    restore,
    restoreKey: keyFilePath(restore),
  }
}

function exists(file: string): boolean {
  return fs.existsSync(file)
}

function fsyncParent(file: string): void {
  fsyncDirectory(path.dirname(file))
}

function moveAside(from: string, to: string): void {
  if (!exists(from) || exists(to)) return
  fs.renameSync(from, to)
}

function secureEach(files: readonly string[]): void {
  for (const file of files) secureRemove(file)
}

/** The previous pair stays on disk until the prepared pair has replaced it. */
function moveCurrentToPrev(set: RestoreSet): void {
  moveAside(set.dest, set.prev)
  moveAside(set.wal, set.prevWal)
  moveAside(set.shm, set.prevShm)
  moveAside(set.key, set.prevKey)
  fsyncParent(set.dest)
}

function deletePrev(set: RestoreSet): void {
  secureEach([set.prev, set.prevKey, set.prevWal, set.prevShm])
  fsyncParent(set.dest)
}

function deletePrepared(set: RestoreSet): void {
  secureEach([set.restore, set.restoreKey, `${set.restore}-wal`, `${set.restore}-shm`])
}

function prevFiles(set: RestoreSet): string[] {
  return [set.prev, set.prevKey, set.prevWal, set.prevShm]
}

function preparedFiles(set: RestoreSet): string[] {
  return [set.restore, set.restoreKey]
}

/** Finish a commit. Does not simulate crashes. */
function swapInPrepared(set: RestoreSet): void {
  moveCurrentToPrev(set)
  if (exists(set.restore)) fs.renameSync(set.restore, set.dest)
  fsyncParent(set.dest)
  if (exists(set.restoreKey)) fs.renameSync(set.restoreKey, set.key)
  fsyncParent(set.dest)
  deletePrev(set)
  deletePrepared(set)
}

function rollBackPrev(set: RestoreSet): void {
  if (exists(set.dest) && exists(set.prev)) secureRemove(set.dest)
  if (exists(set.key) && exists(set.prevKey)) secureRemove(set.key)
  moveAside(set.prev, set.dest)
  moveAside(set.prevWal, set.wal)
  moveAside(set.prevShm, set.shm)
  moveAside(set.prevKey, set.key)
  deletePrepared(set)
  fsyncParent(set.dest)
}

function destinationOccupied(set: RestoreSet): boolean {
  return [set.dest, set.key, set.wal, set.shm].some(exists)
}

/** The commit has not started. Keep an existing destination and drop the prepared copy. */
function recoverBeforeCommit(set: RestoreSet): void {
  if (destinationOccupied(set) || !backupPairComplete(set.restore)) {
    deletePrepared(set)
    return
  }
  swapInPrepared(set)
}

/** The commit has started. Finish the new pair, or put the previous pair back. */
function recoverDuringCommit(set: RestoreSet): void {
  if (backupPairComplete(set.dest)) {
    deletePrev(set)
    deletePrepared(set)
    return
  }
  const keyLeft = exists(set.dest) && exists(set.restoreKey)
  if (backupPairComplete(set.restore) || keyLeft) {
    swapInPrepared(set)
    return
  }
  if (backupPairComplete(set.prev)) rollBackPrev(set)
}

/**
 * Complete or roll back a leftover `.restore` / `.prev` set so the database and its key file match.
 * Called on open, before the race file is used.
 */
export function recoverRestore(dest: string): void {
  const set = restoreSet(dest)
  const started = prevFiles(set).some(exists)
  const prepared = preparedFiles(set).some(exists)
  if (!started && !prepared) return
  if (!started) recoverBeforeCommit(set)
  else recoverDuringCommit(set)
}

/**
 * Backup pair order:
 * 1. wal_checkpoint(TRUNCATE) on the open database
 * 2. atomic copy of the database
 * 3. atomic copy of the key file
 * 4. fsync of the destination directory
 * A crash before step 3 leaves a database without its key file. Restore skips that pair.
 */
function writeBackupPair(databaseSource: string, databaseDest: string): void {
  if (!backupPairComplete(databaseSource)) throw new Error('key file missing')
  atomicCopyFile(databaseSource, databaseDest)
  try {
    atomicCopyFile(keyFilePath(databaseSource), keyFilePath(databaseDest))
    fsyncParent(databaseDest)
  } catch (error) {
    secureRemove(databaseDest)
    secureRemove(keyFilePath(databaseDest))
    throw error
  }
}

function bindKeyFile(filePath: string, raw: SqliteDatabase): void {
  ensureKeyFile(filePath, ensureFileId(raw))
}

/** Consistent encrypted snapshot of the database and its key file. */
export async function backupDatabase(db: AppDb, dest: string): Promise<void> {
  if (db.filePath === ':memory:' || !db.dataKey) {
    throw new Error('Backup failed: a memory database has no file to copy')
  }
  const destKey = keyFilePath(dest)
  let copied = false
  try {
    bindKeyFile(db.filePath, db.raw)
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    writeBackupPair(db.filePath, dest)
    copied = true
    restrictPermissions(dest)
  } catch (error) {
    if (copied) {
      fs.rmSync(dest, { force: true })
      secureRemove(destKey)
    }
    if (error instanceof RaceFileError) throw error
    throw new Error('Backup failed')
  }
  try {
    assertBackupIntegrity(dest, db.dataKey)
    if (!backupPairComplete(dest)) throw new Error('Backup integrity check failed')
  } catch (error) {
    fs.rmSync(dest, { force: true })
    secureRemove(destKey)
    if (error instanceof Error && error.message.startsWith('Backup integrity check failed')) throw error
    throw new Error('Backup integrity check failed')
  }
}

/**
 * Restore a complete pair onto dest.
 * Preparation writes `.restore` files and runs `beforeOpen` there. The commit then moves the
 * current database, `-wal`, `-shm` and key file to `.prev`, renames the prepared pair into
 * place, and deletes `.prev` last. The old journal is not removed before the new files land.
 * The caller must close any handle on `destDatabase` before this runs. An open handle keeps
 * the previous inode. A throw before the commit leaves that file untouched.
 */
export async function restoreBackupPair(
  databaseBackup: string,
  destDatabase: string,
  beforeOpen: (prepared: string) => Promise<void> | void,
): Promise<boolean> {
  if (!backupPairComplete(databaseBackup)) return false
  const set = restoreSet(destDatabase)
  try {
    writeBackupPair(databaseBackup, set.restore)
    await beforeOpen(set.restore)
    secureEach([`${set.restore}-wal`, `${set.restore}-shm`])
    crash('prepared')
    moveCurrentToPrev(set)
    crash('prev')
    if (exists(set.restore)) fs.renameSync(set.restore, set.dest)
    fsyncParent(set.dest)
    crash('database')
    if (exists(set.restoreKey)) fs.renameSync(set.restoreKey, set.key)
    fsyncParent(set.dest)
    crash('keys')
    deletePrev(set)
  } catch (error) {
    if (!restoreHooks.crashAt) deletePrepared(set)
    throw error
  }
  return true
}

export function assertBackupIntegrity(file: string, dataKey: Buffer): void {
  if (!dataKey || dataKey.length !== 32) throw new Error('Backup integrity check failed')
  let raw: SqliteDatabase | undefined
  try {
    raw = openEncrypted(file, dataKey)
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
