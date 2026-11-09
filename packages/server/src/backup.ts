// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path'
import { AppError } from '@ert/core'
import { AppDb, backupDatabase, openDatabase, pruneBackups, pruneSchemaBackups, restoreBackupPair } from '@ert/storage'
import { ensureOwnerOnlyDirectory } from './private-dir.js'
import { Clock, RaceService } from './service.js'

function retentionMonths(db: AppDb): number {
  const row = db.get<{ settings_json: string }>('SELECT settings_json FROM event LIMIT 1')
  if (!row) return 12
  try {
    const parsed = JSON.parse(row.settings_json) as { retention_months?: number }
    if (parsed.retention_months && parsed.retention_months > 0) return parsed.retention_months
  } catch {
    // A broken settings document falls back to the default period.
  }
  return 12
}

/** Write one consistent backup and rotate copies down to the retention period. */
export async function writeBackup(db: AppDb, directory: string, reason: string, now = new Date()): Promise<string> {
  ensureOwnerOnlyDirectory(directory)
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dest = path.join(directory, `ert-${stamp}-${reason}.sqlite`)
  await backupDatabase(db, dest)
  const months = retentionMonths(db)
  pruneBackups(directory, months, now.getTime())
  if (db.filePath !== ':memory:') pruneSchemaBackups(path.dirname(db.filePath), months, now.getTime())
  return dest
}

/** Scheduled backup. Failures are logged and do not stop the process. */
export async function runScheduledBackup(
  db: AppDb,
  directory: string,
  log: (message: string) => void = console.error,
): Promise<void> {
  try {
    await writeBackup(db, directory, 'schedule')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    log(`Scheduled backup failed: ${detail}`)
  }
}

/**
 * Copy a backup pair into a temp pair, anonymise that copy when the retention deadline has passed, and close it.
 * The database and the key file replace the destination only after that. The caller opens the destination then.
 * Close any handle on `destDatabase` before calling. The restore renames that path, and an open handle keeps
 * the previous inode. The backup file is not rewritten. An incomplete pair is skipped. A failure before the
 * commit leaves the destination in place.
 */
export async function restoreBackup(databaseBackup: string, destDatabase: string, dataKey: Buffer, now = Date.now()): Promise<boolean> {
  const key = Buffer.from(dataKey)
  try {
    return await restoreBackupPair(databaseBackup, destDatabase, (dest) => anonymizeBeforeOpen(dest, key, now))
  } finally {
    key.fill(0)
  }
}

function retentionSkipped(error: unknown): boolean {
  if (!(error instanceof AppError)) return false
  return error.code === 'VALIDATION_ERROR' || error.code === 'NOT_FOUND' || error.code === 'LOCK_BLOCKED'
}

/** Run the existing retention job. A race that was unlocked is locked only for that call. */
function anonymizeIfDue(db: AppDb, now: number): void {
  const clock = new Clock()
  clock.set(now)
  const service = new RaceService(db, clock)
  const races = db.all<{ id: string; locked_at: number | null }>('SELECT id, locked_at FROM race')
  const wasLocked = races.length > 0 && races.every((race) => race.locked_at != null)
  if (!wasLocked) {
    for (const race of races) db.run('UPDATE race SET locked_at = ? WHERE id = ?', now, race.id)
  }
  try {
    service.runRetention(now)
  } catch (error) {
    if (!retentionSkipped(error)) throw error
  } finally {
    if (!wasLocked) {
      for (const race of races) db.run('UPDATE race SET locked_at = ? WHERE id = ?', race.locked_at, race.id)
    }
  }
}

/** Open the restored copy, run retention anonymisation, checkpoint, and close it. */
async function anonymizeBeforeOpen(dest: string, dataKey: Buffer, now: number): Promise<void> {
  const db = await openDatabase(dest, { dataKey })
  try {
    anonymizeIfDue(db, now)
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.raw.close()
  }
}

export function startBackupSchedule(db: AppDb, directory: string, log: (message: string) => void = console.error): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runScheduledBackup(db, directory, log)
  }, 5 * 60 * 1000)
  timer.unref()
  return timer
}
