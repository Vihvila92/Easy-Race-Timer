// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { addMonths } from '@ert/core'
import { secureRemove } from './atomic.js'
import { backupPairComplete, databasePathForKeyFile, keyFilePath } from './key-file.js'

/**
 * Newest complete `.sqlite` pairs kept in full, plus one complete pair per UTC day.
 * 48 is four hours of the five-minute backup schedule.
 */
export const BACKUP_KEEP_RECENT = 48

interface ListedBackup {
  full: string
  mtime: number
  day: string
  sqlite: boolean
  complete: boolean
}

interface AgeSweep {
  directory: string
  retentionMonths: number
  today: string
  removed: string[]
}

const SCHEMA_BACKUP = /\.sqlite\.v\d+\.bak$/
const KEY_SCHEMA_BACKUP = /\.v\d+\.keys$/

function pastRetention(day: string, retentionMonths: number, today: string): boolean {
  return addMonths(day, retentionMonths) < today
}

function olderThanRetention(file: string, retentionMonths: number, today: string): boolean {
  const day = new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 10)
  return pastRetention(day, retentionMonths, today)
}

function retentionToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
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

/** An aged sidecar whose database copy is already gone. A sidecar still paired with a database stays. */
function removeOrphanKey(keyBackup: string, retentionMonths: number, today: string, removed: string[]): void {
  if (!fs.existsSync(keyBackup) || fs.existsSync(databasePathForKeyFile(keyBackup))) return
  if (!olderThanRetention(keyBackup, retentionMonths, today)) return
  secureRemove(keyBackup)
  removed.push(keyBackup)
}

function sweepOrphanKeys(directory: string, retentionMonths: number, today: string, removed: string[]): void {
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.keys') && !KEY_SCHEMA_BACKUP.test(name)) continue
    removeOrphanKey(path.join(directory, name), retentionMonths, today, removed)
  }
}

function removeExpiredSchemas(sweep: AgeSweep): void {
  for (const name of fs.readdirSync(sweep.directory)) {
    if (!SCHEMA_BACKUP.test(name)) continue
    const full = path.join(sweep.directory, name)
    if (olderThanRetention(full, sweep.retentionMonths, sweep.today)) removeBackupPair(full, sweep.removed)
  }
}

function listBackups(directory: string): ListedBackup[] {
  const listed: ListedBackup[] = []
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.sqlite') && !SCHEMA_BACKUP.test(name)) continue
    const full = path.join(directory, name)
    const mtime = fs.statSync(full).mtimeMs
    listed.push({
      full,
      mtime,
      day: new Date(mtime).toISOString().slice(0, 10),
      sqlite: name.endsWith('.sqlite'),
      complete: backupPairComplete(full),
    })
  }
  return listed
}

function byNewest(a: ListedBackup, b: ListedBackup): number {
  if (a.mtime !== b.mtime) return b.mtime - a.mtime
  if (a.full === b.full) return 0
  return a.full < b.full ? 1 : -1
}

function keptBackups(found: readonly ListedBackup[], retentionMonths: number, today: string): Set<string> {
  const complete = found.filter((item) => item.complete).sort(byNewest)
  const within = complete.filter((item) => item.sqlite && !pastRetention(item.day, retentionMonths, today))
  const keep = new Set<string>()
  const newestSqlite = complete.find((item) => item.sqlite)
  if (newestSqlite) keep.add(newestSqlite.full)
  for (const item of within.slice(0, BACKUP_KEEP_RECENT)) keep.add(item.full)
  addDaily(within, keep)
  return keep
}

function addDaily(candidates: readonly ListedBackup[], keep: Set<string>): void {
  const days = new Set<string>()
  for (const item of candidates) {
    if (days.has(item.day)) continue
    days.add(item.day)
    keep.add(item.full)
  }
}

function removeUnkept(found: readonly ListedBackup[], keep: ReadonlySet<string>, sweep: AgeSweep): void {
  for (const item of found) {
    if (keep.has(item.full)) continue
    const expired = pastRetention(item.day, sweep.retentionMonths, sweep.today)
    if (expired || (item.sqlite && item.complete)) removeBackupPair(item.full, sweep.removed)
  }
}

/**
 * Delete expired backups, then keep the newest `BACKUP_KEEP_RECENT` complete `.sqlite`
 * pairs plus the newest complete `.sqlite` pair of each other UTC day.
 * An incomplete pair does not count. Expired incomplete pairs are deleted.
 * The newest complete `.sqlite` pair is never deleted, even when a newer schema
 * backup exists or the pair is past the retention period.
 * Schema `.vN.bak` pairs are deleted only by age. Paired key files go with the database.
 */
export function pruneBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  if (!fs.existsSync(directory)) return []
  const today = retentionToday(now)
  const removed: string[] = []
  const found = listBackups(directory)
  const sweep = { directory, retentionMonths, today, removed }
  removeUnkept(found, keptBackups(found, retentionMonths, today), sweep)
  sweepOrphanKeys(directory, retentionMonths, today, removed)
  return removed
}

/** Delete aged pre-migration backups beside the live race file. Does not touch the live file or its key sidecar. */
export function pruneSchemaBackups(directory: string, retentionMonths: number, now = Date.now()): string[] {
  if (!fs.existsSync(directory)) return []
  const removed: string[] = []
  const sweep = { directory, retentionMonths, today: retentionToday(now), removed }
  removeExpiredSchemas(sweep)
  sweepOrphanKeys(directory, retentionMonths, sweep.today, removed)
  return removed
}
