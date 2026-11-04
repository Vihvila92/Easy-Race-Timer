// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { addMonths } from '@ert/core'
import { atomicCopyFile, fsyncDirectory, secureRemove } from './atomic.js'
import { openEncrypted, restrictPermissions, type SqliteDatabase } from './cipher.js'
import { RaceFileError } from './errors.js'
import { backupPairComplete, keyFilePath } from './key-file.js'
import { backupHooks, bindKeyFile, type AppDb } from './db.js'

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
    fsyncDirectory(path.dirname(databaseDest))
    backupHooks.onStep?.('directory')
  } catch (error) {
    secureRemove(databaseDest)
    secureRemove(keyFilePath(databaseDest))
    throw error
  }
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
 * Copy a complete backup pair over dest.
 * A database without its key file, or a key file that is not a whole stub or envelope, is skipped.
 */
export function restoreBackupPair(databaseBackup: string, destDatabase: string): boolean {
  if (!backupPairComplete(databaseBackup)) return false
  writeBackupPair(databaseBackup, destDatabase)
  return true
}

export function assertBackupIntegrity(file: string, dataKey: Buffer): void {
  if (!dataKey || dataKey.length !== 32) throw new Error('Backup integrity check failed')
  const key = dataKey
  let raw: SqliteDatabase | undefined
  try {
    raw = openEncrypted(file, key)
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

const SCHEMA_BACKUP = /\.sqlite\.v\d+\.bak$/

function olderThanRetention(file: string, retentionMonths: number, today: string): boolean {
  const stat = fs.statSync(file)
  const mtime = new Date(stat.mtimeMs).toISOString().slice(0, 10)
  return addMonths(mtime, retentionMonths) < today
}

/** Delete a database backup and the key sidecar copied with it. */
function removeBackupPair(databaseBackup: string, removed: string[]): void {
  secureRemove(databaseBackup)
  removed.push(databaseBackup)
  const key = keyFilePath(databaseBackup)
  if (key !== databaseBackup && fs.existsSync(key)) {
    secureRemove(key)
    removed.push(key)
  }
}

/** Delete aged complete pairs. A database without its key file, or a key file without its database, is left in place. */
function pruneCompletePairs(directory: string, retentionMonths: number, today: string, include: (name: string) => boolean): string[] {
  const removed: string[] = []
  for (const name of fs.readdirSync(directory)) {
    if (!include(name)) continue
    const full = path.join(directory, name)
    if (!olderThanRetention(full, retentionMonths, today)) continue
    const key = keyFilePath(full)
    if (key === full || !fs.existsSync(key)) continue
    removeBackupPair(full, removed)
  }
  return removed
}

function pruneAged(directory: string, retentionMonths: number, now: number, include: (name: string) => boolean): string[] {
  if (!fs.existsSync(directory)) return []
  const today = new Date(now).toISOString().slice(0, 10)
  return pruneCompletePairs(directory, retentionMonths, today, include)
}

/** Delete backup files older than the retention period, including `<file>.v<version>.bak` and the paired key file. */
export function pruneBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  return pruneAged(directory, retentionMonths, now, (name) => name.endsWith('.sqlite') || SCHEMA_BACKUP.test(name))
}

/** Delete aged pre-migration backups beside the live race file. Does not touch the live file or its key sidecar. */
export function pruneSchemaBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  return pruneAged(directory, retentionMonths, now, (name) => SCHEMA_BACKUP.test(name))
}
