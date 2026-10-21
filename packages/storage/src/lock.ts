import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export interface HeldLock {
  close(): void
}

/**
 * Hold `lockPath` so a second server cannot start on the same data directory.
 * The connection stays open. The operating system releases it when this process exits.
 */
export function holdExclusiveLock(lockPath: string): HeldLock {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const db = new Database(lockPath)
  db.pragma('busy_timeout = 0')
  db.pragma('locking_mode = EXCLUSIVE')
  try {
    db.exec('BEGIN EXCLUSIVE')
  } catch {
    db.close()
    throw new Error('Easy Race Timer is already running')
  }
  return {
    close() {
      try {
        db.close()
      } catch {
        // The process is already shutting down.
      }
    },
  }
}
