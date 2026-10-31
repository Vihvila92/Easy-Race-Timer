// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { KeyError } from './errors.js'
import { writePrivateBytes } from './key-file.js'

export const backoffClock = {
  now(): number {
    return Date.now()
  },
}

interface BackoffRecord {
  failureCount: number
  lastAttemptMs: number
}

export interface AttemptDecision {
  proceed: boolean
  failureCount: number
  retryAfterMs?: number
}

/** `n` is the number of failures already recorded. The attempt after the fifth waits 1s, then doubles, capped at 900s. */
export function delaySeconds(priorFailures: number): number {
  if (!Number.isFinite(priorFailures) || priorFailures < 5) return 0
  const shift = priorFailures - 5
  if (shift >= 10) return 900
  return Math.min(900, 2 ** shift)
}

function recordPath(databasePath: string): string {
  return path.join(path.dirname(databasePath), 'unlock-backoff.json')
}

function readRecord(file: string): BackoffRecord {
  if (!fs.existsSync(file)) return { failureCount: 0, lastAttemptMs: 0 }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; failureCount?: unknown; lastAttemptMs?: unknown }
    if (parsed.version !== 1) return { failureCount: 0, lastAttemptMs: 0 }
    if (typeof parsed.failureCount !== 'number' || !Number.isSafeInteger(parsed.failureCount) || parsed.failureCount < 0) return { failureCount: 0, lastAttemptMs: 0 }
    if (typeof parsed.lastAttemptMs !== 'number' || !Number.isSafeInteger(parsed.lastAttemptMs) || parsed.lastAttemptMs < 0) return { failureCount: 0, lastAttemptMs: 0 }
    return { failureCount: parsed.failureCount, lastAttemptMs: parsed.lastAttemptMs }
  } catch {
    return { failureCount: 0, lastAttemptMs: 0 }
  }
}

function writeRecord(file: string, record: BackoffRecord): void {
  const body = Buffer.from(JSON.stringify({ version: 1, failureCount: record.failureCount, lastAttemptMs: record.lastAttemptMs }))
  writePrivateBytes(file, body)
}

function acquire(directory: string): void {
  const lock = path.join(directory, 'unlock-backoff.lock')
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let stale = false
      try {
        stale = Date.now() - fs.statSync(lock).mtimeMs > 30_000
      } catch {
        stale = true
      }
      if (stale) {
        try {
          fs.rmdirSync(lock)
        } catch {
          // Another attempt removed or replaced the lock.
        }
        continue
      }
      if (Date.now() > deadline) throw new KeyError('UNLOCK_FAILED')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15)
    }
  }
}

function release(directory: string): void {
  try {
    fs.rmdirSync(path.join(directory, 'unlock-backoff.lock'))
  } catch {
    // The lock directory is already gone.
  }
}

function withLock<T>(databasePath: string, fn: () => T): T {
  const directory = path.dirname(databasePath)
  fs.mkdirSync(directory, { recursive: true })
  acquire(directory)
  try {
    return fn()
  } finally {
    release(directory)
  }
}

/**
 * Increment and fsync the directory counter before the caller runs a KDF.
 * A wait returns without incrementing again and without running a KDF.
 */
export function beginAttempt(databasePath: string, now = backoffClock.now()): AttemptDecision {
  return withLock(databasePath, () => {
    const file = recordPath(databasePath)
    const record = readRecord(file)
    if (!fs.existsSync(file)) writeRecord(file, record)
    const delayMs = delaySeconds(record.failureCount) * 1000
    let wait = 0
    if (record.failureCount === 0) wait = 0
    else if (record.lastAttemptMs === 0 || record.lastAttemptMs > now) wait = delayMs
    else wait = Math.max(0, record.lastAttemptMs + delayMs - now)
    if (wait > 0) return { proceed: false, failureCount: record.failureCount, retryAfterMs: wait }
    const next = { failureCount: record.failureCount + 1, lastAttemptMs: now }
    writeRecord(file, next)
    return { proceed: true, failureCount: next.failureCount }
  })
}

export function resetAttempts(databasePath: string): void {
  withLock(databasePath, () => {
    writeRecord(recordPath(databasePath), { failureCount: 0, lastAttemptMs: 0 })
  })
}
