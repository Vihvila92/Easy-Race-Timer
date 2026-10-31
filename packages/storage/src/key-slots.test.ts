// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeyError } from './errors.js'
import { backoffClock } from './key-backoff.js'
import { initializeEncryptedFile } from './db.js'
import { openSlot, parseEnvelope, SLOT_OFFSETS } from './key-envelope.js'
import { keyFilePath } from './key-file.js'
import { BASELINE_ARGON, deriveAdminKek, formatRecoveryKey, kdfHooks, normalizeRecoveryText, parseRecoveryKey, passwordBytes, utf8Password } from './key-kdf.js'
import { redactCrash, setKeyLogger } from './key-log.js'
import { keyRandom } from './key-random.js'
import {
  createProtectedRaceFile,
  keyHooks,
  normalUseAllowed,
  regenerateRecoveryKey,
  rewrapAdminSlot,
  sealEnvelope,
  unlockWithPassword,
  unlockWithRecovery,
} from './key-slots.js'

const ADMIN_A = 'correct-horse-battery'
const ADMIN_B = 'staple-river-margin'
const dirs: string[] = []
const originalBytes = keyRandom.bytes
const logs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-slots-'))
  dirs.push(dir)
  return dir
}

function clonePair(file: string): string {
  const dir = tempDir()
  const dest = path.join(dir, path.basename(file))
  fs.copyFileSync(file, dest)
  fs.copyFileSync(keyFilePath(file), keyFilePath(dest))
  return dest
}

function slotBytes(file: string, index: number): Buffer {
  const bytes = fs.readFileSync(keyFilePath(file))
  const offset = SLOT_OFFSETS[index]!
  return Buffer.from(bytes.subarray(offset, offset + 96))
}

function bodyHash(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function contains(directory: string, needle: Buffer): boolean {
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

function secretEncodings(secret: Buffer): Buffer[] {
  const hex = secret.toString('hex')
  return [Buffer.from(secret), Buffer.from(hex), Buffer.from(hex.toUpperCase()), Buffer.from(secret.toString('base64')), Buffer.from(secret.toString('base64url'))]
}

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

describe('recovery key text', () => {
  it('accepts Crockford aliases and rejects a checksum typo before HKDF', () => {
    const secret = Buffer.alloc(20, 0)
    secret[0] = 1
    const printed = formatRecoveryKey(secret)
    expect(normalizeRecoveryText('o-i l\nu')).toBe('011V')
    const aliased = printed.replaceAll('0', 'O').replaceAll('1', 'L').replaceAll('V', 'U')
    expect(parseRecoveryKey(aliased).equals(secret)).toBe(true)
    const chars = printed.replaceAll('-', '')
    const flipped = `${chars.slice(0, 4)}B${chars.slice(5)}`
    kdfHooks.onHkdf = () => {
      throw new Error('hkdf')
    }
    expect(() => parseRecoveryKey(flipped)).toThrow(KeyError)
    try {
      parseRecoveryKey(flipped)
    } catch (error) {
      expect(error).toBeInstanceOf(KeyError)
      expect((error as KeyError).code).toBe('RECOVERY_KEY_CHECKSUM')
    }
    expect(() => parseRecoveryKey(`${printed}*`)).toThrow(KeyError)
  })
})

describe('password policy', () => {
  it('rejects short, long, common and equal passwords and accepts 10 and 64', async () => {
    expect(() => passwordBytes('abcdefghi', 'abcdefghi')).toThrow(expect.objectContaining({ code: 'PASSWORD_TOO_SHORT' }))
    expect(() => passwordBytes('password123', 'password123')).toThrow(expect.objectContaining({ code: 'PASSWORD_COMMON' }))
    const ten = passwordBytes('abcdefghij', 'abcdefghij')
    ten.fill(0)
    const sixtyFour = passwordBytes('k'.repeat(64), 'k'.repeat(64))
    sixtyFour.fill(0)
    expect(() => passwordBytes('k'.repeat(129), 'k'.repeat(129))).toThrow(expect.objectContaining({ code: 'PASSWORD_TOO_LONG' }))
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    await expect(createProtectedRaceFile(file, { password: 'k'.repeat(129), confirm: 'k'.repeat(129) }, { password: ADMIN_B, confirm: ADMIN_B })).rejects.toMatchObject({ code: 'PASSWORD_TOO_LONG' })
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.existsSync(keyFilePath(file))).toBe(false)
    await expect(createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_A, confirm: ADMIN_A })).rejects.toMatchObject({ code: 'PASSWORD_MISMATCH' })
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('protected race file', () => {
  it('draws a fresh 32-byte data key and opens for either admin', async () => {
    const deks = [Buffer.alloc(32, 0x21), Buffer.alloc(32, 0x22)]
    let drawn = 0
    keyRandom.bytes = (size) => (size === 32 ? Buffer.from(deks[drawn++]!) : originalBytes(size))
    const firstDir = tempDir()
    const secondDir = tempDir()
    const first = await createProtectedRaceFile(path.join(firstDir, 'ert.sqlite'), { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const second = await createProtectedRaceFile(path.join(secondDir, 'ert.sqlite'), { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const ownedA = first.db.dataKey!
    const seenA = Buffer.from(ownedA)
    const seenB = Buffer.from(second.db.dataKey!)
    expect(seenA.equals(deks[0]!)).toBe(true)
    expect(seenB.equals(deks[1]!)).toBe(true)
    expect(seenA.equals(seenB)).toBe(false)
    expect(first.db.get<{ key_generation: number }>('SELECT key_generation FROM schema_meta WHERE id = 1')?.key_generation).toBe(1)
    expect(fs.readFileSync(keyFilePath(first.db.filePath)).readUInt32BE(26)).toBe(1)
    expect(fs.readFileSync(first.db.filePath).subarray(0, 4).toString('utf8')).not.toBe('ERTK')
    expect(fs.readFileSync(keyFilePath(first.db.filePath)).subarray(0, 4).toString('utf8')).toBe('ERTK')
    expect(first.db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'key_slot'`)).toBeUndefined()
    first.db.raw.close()
    second.db.raw.close()
    expect(ownedA.every((byte) => byte === 0)).toBe(true)
    const calls: number[] = []
    kdfHooks.onDerive = (info) => calls.push(info.slotIndex)
    const opened = await unlockWithPassword(path.join(firstDir, 'ert.sqlite'), ADMIN_A)
    expect(calls).toEqual([0, 1])
    expect(normalUseAllowed(opened)).toBe(true)
    opened.raw.close()
    calls.length = 0
    const other = await unlockWithPassword(path.join(firstDir, 'ert.sqlite'), ADMIN_B)
    expect(calls).toEqual([0, 1])
    other.raw.close()
    calls.length = 0
    const wrong = await unlockWithPassword(path.join(firstDir, 'ert.sqlite'), 'not-the-admin-password').then(() => null, (error: unknown) => error)
    expect(wrong).toBeInstanceOf(KeyError)
    const keyError = wrong as KeyError
    expect(keyError.code).toBe('UNLOCK_FAILED')
    expect(keyError.toJSON().error).not.toHaveProperty('slot')
    expect(JSON.stringify(keyError)).not.toContain('slot')
    expect(calls).toEqual([0, 1])
  })

  it('opens with the recovery key, then requires a new admin password', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const printed = created.recoveryKey.toString('ascii')
    created.db.raw.pragma('wal_checkpoint(TRUNCATE)')
    const before = slotBytes(file, 1)
    created.db.raw.close()
    const gated = await unlockWithRecovery(file, printed)
    expect(normalUseAllowed(gated)).toBe(false)
    await rewrapAdminSlot(gated, 0, { password: 'replaced-admin-password', confirm: 'replaced-admin-password' })
    expect(slotBytes(file, 1).equals(before)).toBe(true)
    expect(normalUseAllowed(gated)).toBe(true)
    gated.raw.close()
    created.recoveryKey.fill(0)
  })

  it('rewraps one slot, leaves the body and the other slot, and rejects an unauthenticated caller', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    created.db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Aino', 'Testi', 'F', 2014, 'full', 1, 1, '1')`)
    created.db.raw.pragma('wal_checkpoint(TRUNCATE)')
    const preserved = clonePair(file)
    const beforeSlot = slotBytes(file, 0)
    const beforeNonce = Buffer.from(fs.readFileSync(keyFilePath(file)).subarray(SLOT_OFFSETS[1]! + 36, SLOT_OFFSETS[1]! + 48))
    const beforeHash = bodyHash(file)
    await rewrapAdminSlot(created.db, 1, { password: 'second-admin-replaced', confirm: 'second-admin-replaced' })
    created.db.raw.pragma('wal_checkpoint(TRUNCATE)')
    expect(slotBytes(file, 0).equals(beforeSlot)).toBe(true)
    expect(bodyHash(file)).toBe(beforeHash)
    const afterNonce = fs.readFileSync(keyFilePath(file)).subarray(SLOT_OFFSETS[1]! + 36, SLOT_OFFSETS[1]! + 48)
    expect(Buffer.from(afterNonce).equals(beforeNonce)).toBe(false)
    created.db.keySession = null
    await expect(rewrapAdminSlot(created.db, 0, { password: 'another-admin-password', confirm: 'another-admin-password' }, ADMIN_A)).rejects.toBeInstanceOf(KeyError)
    created.db.raw.close()
    await expect(unlockWithPassword(file, ADMIN_B)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const next = await unlockWithPassword(file, 'second-admin-replaced')
    expect(next.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    next.raw.close()
    const still = await unlockWithPassword(file, ADMIN_A)
    still.raw.close()
    const old = await unlockWithPassword(preserved, ADMIN_B)
    expect(old.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    old.raw.close()
  })

  it('replaces the nonce even when the password bytes stay the same', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const key = fs.readFileSync(keyFilePath(file))
    const existing = Buffer.from(key.subarray(SLOT_OFFSETS[0]! + 36, SLOT_OFFSETS[0]! + 48))
    let nonceDraws = 0
    keyRandom.bytes = (size) => {
      if (size !== 12) return originalBytes(size)
      nonceDraws += 1
      if (nonceDraws === 1) return Buffer.from(existing)
      return originalBytes(size)
    }
    await rewrapAdminSlot(created.db, 0, { password: ADMIN_A, confirm: ADMIN_A }, ADMIN_A)
    expect(nonceDraws).toBeGreaterThanOrEqual(2)
    const updated = fs.readFileSync(keyFilePath(file))
    const nonces = [0, 1, 2].map((index) => updated.subarray(SLOT_OFFSETS[index]! + 36, SLOT_OFFSETS[index]! + 48).toString('hex'))
    expect(new Set(nonces).size).toBe(3)
    expect(nonces[0]).not.toBe(existing.toString('hex'))
    const salts = [0, 1, 2].map((index) => updated.subarray(SLOT_OFFSETS[index]! + 20, SLOT_OFFSETS[index]! + 36).toString('hex'))
    expect(new Set(salts).size).toBe(3)
    expect(salts[0]).not.toBe(key.subarray(SLOT_OFFSETS[0]! + 20, SLOT_OFFSETS[0]! + 36).toString('hex'))
    created.db.raw.close()
  })

  it('fails closed on a tampered header and refuses a downgraded slot before Argon2id', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    created.db.raw.pragma('wal_checkpoint(TRUNCATE)')
    created.db.raw.close()
    const original = fs.readFileSync(keyFilePath(file))
    const cases: Array<{ edit: (bytes: Buffer) => void; code: string; derives: boolean }> = [
      { edit: (bytes) => bytes.writeUInt16BE(2, 4), code: 'FILE_HEADER_INVALID', derives: false },
      { edit: (bytes) => bytes.writeUInt32BE(65537, SLOT_OFFSETS[0]! + 4), code: 'UNLOCK_FAILED', derives: true },
      { edit: (bytes) => bytes.writeUInt32BE(4, SLOT_OFFSETS[0]! + 8), code: 'UNLOCK_FAILED', derives: true },
      { edit: (bytes) => bytes.writeUInt32BE(2, SLOT_OFFSETS[0]! + 12), code: 'UNLOCK_FAILED', derives: true },
      { edit: (bytes) => { bytes[SLOT_OFFSETS[0]! + 20]! ^= 0xff }, code: 'UNLOCK_FAILED', derives: true },
      { edit: (bytes) => bytes.writeUInt8(9, SLOT_OFFSETS[0]! + 2), code: 'KEY_PARAMS_REJECTED', derives: false },
      { edit: (bytes) => bytes.writeUInt8(2, SLOT_OFFSETS[0]! + 1), code: 'KEY_PARAMS_REJECTED', derives: false },
      { edit: (bytes) => { bytes[8]! ^= 0xff }, code: 'UNLOCK_FAILED', derives: true },
      { edit: (bytes) => bytes.writeUInt32BE(8192, SLOT_OFFSETS[0]! + 4), code: 'KEY_PARAMS_REJECTED', derives: false },
      { edit: (bytes) => bytes.writeUInt32BE(2, SLOT_OFFSETS[0]! + 8), code: 'KEY_PARAMS_REJECTED', derives: false },
      { edit: (bytes) => bytes.writeUInt32BE(0, SLOT_OFFSETS[0]! + 12), code: 'KEY_PARAMS_REJECTED', derives: false },
    ]
    for (const item of cases) {
      const bytes = Buffer.from(original)
      item.edit(bytes)
      fs.writeFileSync(keyFilePath(file), bytes)
      let derived = false
      kdfHooks.onDerive = () => {
        derived = true
      }
      const error = await unlockWithPassword(file, ADMIN_A).then(() => null, (caught: unknown) => caught)
      expect(error).toBeInstanceOf(KeyError)
      expect((error as KeyError).code).toBe(item.code)
      expect(derived).toBe(item.derives)
    }
    const weakRecovery = Buffer.from(original)
    const recovery = SLOT_OFFSETS[2]!
    weakRecovery.writeUInt8(1, recovery + 2)
    weakRecovery.writeUInt8(0x13, recovery + 3)
    weakRecovery.writeUInt32BE(1024, recovery + 4)
    weakRecovery.writeUInt32BE(3, recovery + 8)
    weakRecovery.writeUInt32BE(1, recovery + 12)
    fs.writeFileSync(keyFilePath(file), weakRecovery)
    let derived = false
    kdfHooks.onDerive = () => {
      derived = true
    }
    const refused = await unlockWithPassword(file, ADMIN_A).then(() => null, (caught: unknown) => caught)
    expect(refused).toMatchObject({ code: 'KEY_PARAMS_REJECTED' })
    expect(derived).toBe(false)
  })

  it('derives a slot with its stored memory cost', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const first = passwordBytes(ADMIN_A, ADMIN_A)
    const second = passwordBytes(ADMIN_B, ADMIN_B)
    const dek = randomBytes(32)
    const fileId = randomBytes(16)
    const secret = randomBytes(20)
    try {
      const envelope = await sealEnvelope({
        dek,
        fileId,
        keyGeneration: 1,
        passwords: [first, second],
        params: [{ memoryKib: 131072, iterations: 3, parallelism: 1 }, BASELINE_ARGON],
        recoverySecret: secret,
      })
      const db = initializeEncryptedFile(file, dek, fileId.toString('hex'), 1)
      writeKey(file, envelope)
      db.raw.close()
    } finally {
      first.fill(0)
      second.fill(0)
      dek.fill(0)
      secret.fill(0)
    }
    const calls: number[] = []
    kdfHooks.onDerive = (info) => calls.push(info.memoryKib)
    const opened = await unlockWithPassword(file, ADMIN_A)
    opened.raw.close()
    expect(calls).toContain(131072)
    const bytes = fs.readFileSync(keyFilePath(file))
    const parsed = parseEnvelope(bytes)
    const password = utf8Password(ADMIN_A)
    const kek = await deriveAdminKek(password, { memoryKib: 65536, iterations: 3, parallelism: 1, slotIndex: 0, slotType: 1, salt: parsed.slots[0].salt })
    password.fill(0)
    expect(() => openSlot(bytes, 0, kek)).toThrow(KeyError)
    kek.fill(0)
  })

  it('rejects a key file whose file id does not match the database', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const dek = Buffer.from(created.db.dataKey!)
    const secret = parseRecoveryKey(created.recoveryKey.toString('ascii'))
    const first = utf8Password(ADMIN_A)
    const second = utf8Password(ADMIN_B)
    const envelope = await sealEnvelope({
      dek,
      fileId: randomBytes(16),
      keyGeneration: 1,
      passwords: [first, second],
      recoverySecret: secret,
    })
    writeKey(file, envelope)
    created.db.raw.close()
    first.fill(0)
    second.fill(0)
    secret.fill(0)
    dek.fill(0)
    let attached = false
    keyHooks.beforeAttach = () => {
      attached = true
    }
    await expect(unlockWithPassword(file, ADMIN_A)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    expect(attached).toBe(false)
  })

  it('counts checksum failures, backs off, and clears the counter after a success', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const printed = created.recoveryKey.toString('ascii')
    created.db.raw.close()
    let now = 10_000
    backoffClock.now = () => now
    kdfHooks.onHkdf = () => {
      throw new Error('hkdf')
    }
    const bad = printed.endsWith('B') ? `${printed.slice(0, -1)}C` : `${printed.slice(0, -1)}B`
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(unlockWithRecovery(file, bad)).rejects.toMatchObject({ code: 'RECOVERY_KEY_CHECKSUM' })
    }
    const waiting = await unlockWithRecovery(file, printed).then(() => null, (error: unknown) => error)
    expect(waiting).toMatchObject({ code: 'UNLOCK_FAILED', retryAfterMs: 1000 })
    expect(JSON.stringify(waiting)).not.toContain('slot')
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'unlock-backoff.json'), 'utf8')) as { failureCount: number; lastAttemptMs: number }
    expect(record.failureCount).toBe(5)
    now = record.lastAttemptMs + 1000
    kdfHooks.onHkdf = undefined
    const opened = await unlockWithRecovery(file, printed)
    opened.raw.close()
    const cleared = JSON.parse(fs.readFileSync(path.join(dir, 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
    expect(cleared.failureCount).toBe(0)
    created.recoveryKey.fill(0)
  })

  it('zeroizes key buffers and keeps secrets out of the directory and the logs', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const canary = 'canary-horse-battery-staple'
    const created = await createProtectedRaceFile(file, { password: canary, confirm: canary }, { password: ADMIN_B, confirm: ADMIN_B })
    const owned = created.db.dataKey!
    const dekCopy = Buffer.from(owned)
    const printed = Buffer.from(created.recoveryKey)
    const rawRecovery = parseRecoveryKey(printed.toString('ascii'))
    created.db.raw.pragma('wal_checkpoint(TRUNCATE)')
    await rewrapAdminSlot(created.db, 1, { password: 'another-canary-password', confirm: 'another-canary-password' })
    const shown = await regenerateRecoveryKey(created.db)
    created.db.raw.close()
    expect(owned.every((byte) => byte === 0)).toBe(true)
    const keks: Buffer[] = []
    kdfHooks.onKek = (kek) => keks.push(kek)
    await expect(unlockWithPassword(file, 'wrong-password-value')).rejects.toBeInstanceOf(KeyError)
    expect(keks.length).toBeGreaterThan(0)
    expect(keks.every((kek) => kek.every((byte) => byte === 0))).toBe(true)
    const needles = [
      ...secretEncodings(dekCopy),
      Buffer.from(canary),
      printed,
      rawRecovery,
      shown,
    ]
    for (const needle of needles) expect(contains(dir, needle)).toBe(false)
    const captured = logs.join('\n')
    const error = new KeyError('UNLOCK_FAILED')
    expect(error.message).not.toContain(canary)
    expect(JSON.stringify(error)).not.toContain(canary)
    expect(captured).not.toContain(canary)
    expect(captured).not.toContain(printed.toString('ascii'))
    expect(redactCrash({ password: canary, nested: { recoveryKey: printed.toString('ascii'), dek: 'secret-dek' } })).not.toContain(canary)
    shown.fill(0)
    printed.fill(0)
    rawRecovery.fill(0)
  })
})

function writeKey(file: string, bytes: Buffer): void {
  fs.writeFileSync(keyFilePath(file), bytes, { mode: 0o600 })
}
