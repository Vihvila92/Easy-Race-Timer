// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicCopyFile, fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { openEncrypted, restrictPermissions, type SqliteDatabase } from './cipher.js'
import { backupHooks, type AppDb } from './db.js'
import { RaceFileError } from './errors.js'
import { backupPairComplete, ensureKeyFile, inspectKeyFile, keyFilePath } from './key-file.js'
import { ensureFileId } from './schema.js'

/** Test seam. Production never sets these. `crashAt` stops after a step and leaves the files. `failRename` throws once per listed rename, then continues. */
export const restoreHooks: {
  crashAt?: 'prepared' | 'prev' | 'database' | 'keys'
  failRename?: Array<'prev-db' | 'prev-wal' | 'prev-shm' | 'prev-key' | 'place-db' | 'place-key' | 'back-db' | 'back-wal' | 'back-shm' | 'back-key'>
} = {}

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

function throwIo(): never {
  const error = new Error('EIO') as NodeJS.ErrnoException
  error.code = 'EIO'
  throw error
}

function renameStep(step: NonNullable<typeof restoreHooks.failRename>[number], from: string, to: string): void {
  const plan = restoreHooks.failRename
  if (plan?.[0] === step) {
    plan.shift()
    throwIo()
  }
  fs.renameSync(from, to)
}

function moveAside(step: NonNullable<typeof restoreHooks.failRename>[number], from: string, to: string): void {
  if (!exists(from) || exists(to)) return
  renameStep(step, from, to)
}

function secureEach(files: readonly string[]): void {
  for (const file of files) secureRemove(file)
}

/** The previous pair stays on disk until the prepared pair has replaced it. */
function moveCurrentToPrev(set: RestoreSet): void {
  moveAside('prev-db', set.dest, set.prev)
  moveAside('prev-wal', set.wal, set.prevWal)
  moveAside('prev-shm', set.shm, set.prevShm)
  moveAside('prev-key', set.key, set.prevKey)
  fsyncParent(set.dest)
}

function deletePrev(set: RestoreSet): void {
  secureEach([set.prev, set.prevKey, set.prevWal, set.prevShm])
  fsyncParent(set.dest)
}

function readyMarker(set: RestoreSet): string {
  return `${set.restore}.ready`
}

function deletePrepared(set: RestoreSet): void {
  secureEach([set.restore, set.restoreKey, `${set.restore}-wal`, `${set.restore}-shm`, readyMarker(set)])
}

/** Drop a prepared copy that never finished anonymisation. Do not open it. */
function discardUnready(set: RestoreSet): void {
  const files = [set.restore, set.restoreKey, `${set.restore}-wal`, `${set.restore}-shm`, readyMarker(set)]
  if (!files.some(exists)) return
  secureEach(files)
  console.warn('Discarded an incomplete restore')
}

function prevFiles(set: RestoreSet): string[] {
  return [set.prev, set.prevKey, set.prevWal, set.prevShm]
}

function preparedFiles(set: RestoreSet): string[] {
  return [set.restore, set.restoreKey, readyMarker(set)]
}

function fileDigest(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function clearReadyMarker(set: RestoreSet): void {
  secureRemove(readyMarker(set))
  fsyncParent(set.dest)
}

/** The marker names one prepared database. A different file does not count. */
function markerMatches(set: RestoreSet): boolean {
  try {
    if (!exists(readyMarker(set))) return false
    const recorded = fs.readFileSync(readyMarker(set), 'utf8').trim()
    const current = exists(set.restore) ? set.restore : set.dest
    return exists(current) && recorded === fileDigest(current)
  } catch {
    return false
  }
}

function keyReady(keyPath: string): boolean {
  const info = inspectKeyFile(keyPath)
  return info.kind === 'stub' || info.kind === 'envelope'
}

function livePairReady(set: RestoreSet): boolean {
  return exists(set.dest) && keyReady(set.key)
}

/** Finish a commit. Does not simulate crashes. */
function swapInPrepared(set: RestoreSet): void {
  moveCurrentToPrev(set)
  if (exists(set.restore)) renameStep('place-db', set.restore, set.dest)
  fsyncParent(set.dest)
  if (exists(set.restoreKey)) renameStep('place-key', set.restoreKey, set.key)
  fsyncParent(set.dest)
  deletePrev(set)
  deletePrepared(set)
}

/** Put one aside file back on the path its live counterpart uses. */
function putBack(step: NonNullable<typeof restoreHooks.failRename>[number], from: string, to: string): void {
  if (!exists(from)) return
  if (exists(to)) secureRemove(to)
  renameStep(step, from, to)
}

function rollBackPrev(set: RestoreSet): void {
  putBack('back-db', set.prev, set.dest)
  putBack('back-wal', set.prevWal, set.wal)
  putBack('back-shm', set.prevShm, set.shm)
  putBack('back-key', set.prevKey, set.key)
  deletePrepared(set)
  fsyncParent(set.dest)
}

function canFinish(set: RestoreSet): boolean {
  if (!markerMatches(set)) return false
  if (exists(set.restore) && keyReady(set.restoreKey)) return true
  return exists(set.dest) && keyReady(set.restoreKey)
}

/** The commit has not started. Commit a prepared copy only after anonymisation marked it ready. */
function recoverBeforeCommit(set: RestoreSet): void {
  if (!canFinish(set)) {
    discardUnready(set)
    return
  }
  swapInPrepared(set)
}

/** The commit has started. Finish the new pair, or put the previous pair back. */
function recoverDuringCommit(set: RestoreSet): 'live' | 'back' {
  if (livePairReady(set)) {
    deletePrev(set)
    deletePrepared(set)
    return 'live'
  }
  if (canFinish(set)) {
    swapInPrepared(set)
    return 'live'
  }
  if (prevFiles(set).some(exists)) {
    rollBackPrev(set)
    return 'back'
  }
  discardUnready(set)
  return 'back'
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
  if (!exists(set.dest) && prevFiles(set).some(exists)) throw new Error('Restore failed')
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
  backupHooks.onStep?.('database')
  try {
    atomicCopyFile(keyFilePath(databaseSource), keyFilePath(databaseDest))
    backupHooks.onStep?.('key')
    fsyncParent(databaseDest)
    backupHooks.onStep?.('directory')
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
 * Preparation writes `.restore` files and runs `beforeOpen` there. That callback must close
 * the prepared database before it returns. A ready marker is written and fsynced only after
 * that return. The marker names that prepared database and is removed when a restore starts
 * and when the commit finishes. The commit then moves the current database, `-wal`, `-shm`
 * and key file to `.prev`, renames the prepared pair into place, and deletes `.prev` last.
 * The old journal is not removed before the new files land. Startup commits a prepared pair
 * only when the marker matches that database. Otherwise those prepared files are discarded
 * without being opened.
 * The caller must close any handle on `destDatabase` before this runs. An open handle keeps
 * the previous inode. A throw before the commit leaves that file untouched. A rename error
 * after the commit has started finishes the swap or puts every aside file back. A new
 * database is not created while an aside file remains.
 */
export async function restoreBackupPair(
  databaseBackup: string,
  destDatabase: string,
  beforeOpen: (prepared: string) => Promise<void> | void,
): Promise<boolean> {
  if (!backupPairComplete(databaseBackup)) return false
  const set = restoreSet(destDatabase)
  try {
    clearReadyMarker(set)
    writeBackupPair(databaseBackup, set.restore)
    await beforeOpen(set.restore)
    secureEach([`${set.restore}-wal`, `${set.restore}-shm`])
    crash('prepared')
    markRestoreReady(set)
    moveCurrentToPrev(set)
    crash('prev')
    if (exists(set.restore)) renameStep('place-db', set.restore, set.dest)
    fsyncParent(set.dest)
    crash('database')
    if (exists(set.restoreKey)) renameStep('place-key', set.restoreKey, set.key)
    fsyncParent(set.dest)
    crash('keys')
    deletePrev(set)
    clearReadyMarker(set)
  } catch (error) {
    if (restoreHooks.crashAt) throw error
    if (!prevFiles(set).some(exists)) {
      deletePrepared(set)
      throw error
    }
    const outcome = settleCommit(set)
    if (outcome === 'live') return true
    throw error
  }
  return true
}

/** Written only after anonymisation has returned and that database is closed. */
function markRestoreReady(set: RestoreSet): void {
  const marker = readyMarker(set)
  fs.writeFileSync(marker, fileDigest(set.restore), { mode: 0o600 })
  fsyncFile(marker)
  fsyncParent(set.dest)
}

function settleCommit(set: RestoreSet): 'live' | 'back' {
  try {
    const outcome = recoverDuringCommit(set)
    if (outcome === 'live') return 'live'
  } catch {
    // The retry failed. Put the previous pair back.
  }
  try {
    if (prevFiles(set).some(exists)) rollBackPrev(set)
    else discardUnready(set)
  } catch {
    return 'back'
  }
  return 'back'
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
