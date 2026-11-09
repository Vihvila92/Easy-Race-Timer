// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'

export interface HeldLock {
  close(): void
}

/**
 * Hold `server.lock` for one data directory so a second server cannot start there.
 * `ERT_DB` must stay inside that directory; a path outside it is not covered.
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
