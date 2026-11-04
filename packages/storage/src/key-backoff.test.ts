// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backoffClock, beginAttempt, delaySeconds, resetAttempts } from './key-backoff.js'

const dirs: string[] = []

function databasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-backoff-'))
  dirs.push(dir)
  return path.join(dir, 'ert.sqlite')
}

afterEach(() => {
  backoffClock.now = () => Date.now()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('delaySeconds', () => {
  it('waits nothing for the first five failures, then doubles up to 900 seconds', () => {
    for (let prior = 0; prior < 5; prior++) expect(delaySeconds(prior)).toBe(0)
    expect(delaySeconds(5)).toBe(1)
    expect(delaySeconds(6)).toBe(2)
    expect(delaySeconds(7)).toBe(4)
    expect(delaySeconds(8)).toBe(8)
    expect(delaySeconds(9)).toBe(16)
    expect(delaySeconds(10)).toBe(32)
    expect(delaySeconds(11)).toBe(64)
    expect(delaySeconds(12)).toBe(128)
    expect(delaySeconds(13)).toBe(256)
    expect(delaySeconds(14)).toBe(512)
    expect(delaySeconds(15)).toBe(900)
    expect(delaySeconds(40)).toBe(900)
  })
})

describe('unlock backoff file', () => {
  it('persists the counter, shares a directory, and does not shorten a backward clock', () => {
    const file = databasePath()
    const sibling = path.join(path.dirname(file), 'other.sqlite')
    let now = 5_000
    for (let attempt = 0; attempt < 5; attempt++) {
      const decision = beginAttempt(file, now)
      expect(decision.proceed).toBe(true)
      expect(decision.retryAfterMs).toBeUndefined()
    }
    const waiting = beginAttempt(sibling, now)
    expect(waiting.proceed).toBe(false)
    expect(waiting.retryAfterMs).toBe(1000)
    const record = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'unlock-backoff.json'), 'utf8')) as { failureCount: number; lastAttemptMs: number }
    expect(record.failureCount).toBe(5)
    expect(record).not.toHaveProperty('password')
    expect(record).not.toHaveProperty('slot')
    now = 1_000
    const backward = beginAttempt(file, now)
    expect(backward.proceed).toBe(false)
    expect(backward.retryAfterMs).toBe(1000)
    fs.rmSync(path.join(path.dirname(file), 'unlock-backoff.json'))
    const reset = beginAttempt(file, now)
    expect(reset.proceed).toBe(true)
    expect(reset.failureCount).toBe(1)
    resetAttempts(file)
    const cleared = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
    expect(cleared.failureCount).toBe(0)
  })

  it('keeps the wait after the module is reloaded', async () => {
    const file = databasePath()
    for (let attempt = 0; attempt < 5; attempt++) beginAttempt(file, 2_000)
    vi.resetModules()
    const reloaded = await import('./key-backoff.js')
    const decision = reloaded.beginAttempt(file, 2_000)
    expect(decision.proceed).toBe(false)
    expect(decision.retryAfterMs).toBe(1000)
    const again = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
    expect(again.failureCount).toBe(5)
  })
})
