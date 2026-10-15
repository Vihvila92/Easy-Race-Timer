import path from 'node:path'
import { AppDb, backupDatabase, pruneBackups } from '@ert/storage'

export function retentionMonths(db: AppDb): number {
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

/** Write one consistent backup and drop copies older than the retention period. */
export async function writeBackup(db: AppDb, directory: string, reason: string, now = new Date()): Promise<string> {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dest = path.join(directory, `ert-${stamp}-${reason}.sqlite`)
  await backupDatabase(db, dest)
  pruneBackups(directory, retentionMonths(db), now.getTime())
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

export function startBackupSchedule(db: AppDb, directory: string, log: (message: string) => void = console.error): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runScheduledBackup(db, directory, log)
  }, 5 * 60 * 1000)
  timer.unref()
  return timer
}
