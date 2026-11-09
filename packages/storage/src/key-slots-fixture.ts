// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { backoffClock } from './key-backoff.js'
import { SLOT_OFFSETS } from './key-envelope.js'
import { keyFilePath } from './key-file.js'
import { kdfHooks } from './key-kdf.js'
import { setKeyLogger } from './key-log.js'
import { keyRandom } from './key-random.js'
import { createProtectedRaceFile, keyHooks } from './key-slots.js'

export const ADMIN_A = 'correct-horse-battery'
export const ADMIN_B = 'staple-river-margin'
export const originalBytes = keyRandom.bytes
export const logs: string[] = []
const dirs: string[] = []

export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-slots-'))
  dirs.push(dir)
  return dir
}

export function clonePair(file: string): string {
  const dir = tempDir()
  const dest = path.join(dir, path.basename(file))
  fs.copyFileSync(file, dest)
  fs.copyFileSync(keyFilePath(file), keyFilePath(dest))
  return dest
}

export function slotBytes(file: string, index: number): Buffer {
  const bytes = fs.readFileSync(keyFilePath(file))
  const offset = SLOT_OFFSETS[index]!
  return Buffer.from(bytes.subarray(offset, offset + 96))
}

export function bodyHash(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function contains(directory: string, needle: Buffer): boolean {
  if (needle.length < 8) return false
  for (const name of fs.readdirSync(directory)) {
    const full = path.join(directory, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      if (contains(full, needle)) return true
      continue
    }
    if (!stat.isFile()) continue
    if (fs.readFileSync(full).includes(needle)) return true
  }
  return false
}

export function secretEncodings(secret: Buffer): Buffer[] {
  const hex = secret.toString('hex')
  return [Buffer.from(secret), Buffer.from(hex), Buffer.from(hex.toUpperCase()), Buffer.from(secret.toString('base64')), Buffer.from(secret.toString('base64url'))]
}

export function writeKey(file: string, bytes: Buffer): void {
  fs.writeFileSync(keyFilePath(file), bytes, { mode: 0o600 })
}

export async function openProtected(): Promise<{ dir: string; file: string; created: Awaited<ReturnType<typeof createProtectedRaceFile>> }> {
  const dir = tempDir()
  const file = path.join(dir, 'ert.sqlite')
  const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
  return { dir, file, created }
}

export function installSlotHooks(): void {
  beforeEach(() => {
    setKeyLogger((event, fields) => {
      logs.push(fields.failureCount === undefined ? event : `${event} ${fields.failureCount}`)
    })
  })
  afterEach(() => {
    keyRandom.bytes = originalBytes
    kdfHooks.onDerive = undefined
    kdfHooks.onKek = undefined
    kdfHooks.onHkdf = undefined
    keyHooks.beforeAttach = undefined
    backoffClock.now = () => Date.now()
    setKeyLogger((event, fields) => {
      logs.push(fields.failureCount === undefined ? event : `${event} ${fields.failureCount}`)
    })
    logs.length = 0
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })
}
