// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, hkdfSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import argon2 from 'argon2'
import { KeyError } from './errors.js'
import { keyRandom } from './key-random.js'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ADMIN_AD = 'ert-admin-kek-v1'
const RECOVERY_AD = 'ert-recovery-kek-v1'
const CHECKSUM_LABEL = 'ert-recovery-checksum-v1'

export const kdfHooks: {
  onDerive?: (info: { memoryKib: number; iterations: number; parallelism: number; slotIndex: number }) => void
  onKek?: (kek: Buffer) => void
  onHkdf?: () => void
} = {}

export interface ArgonParams {
  memoryKib: number
  iterations: number
  parallelism: number
  slotIndex: number
  slotType: number
  salt: Buffer
}

let commonPasswords: Set<string> | null = null

export function resetPasswordListCache(): void {
  commonPasswords = null
}

export function passwordListFile(): string {
  const override = process.env.ERT_PASSWORD_LIST?.trim()
  if (override) return override
  return fileURLToPath(new URL('../passwords/common.txt', import.meta.url))
}

function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32))
}

function loadCommonPasswords(): Set<string> {
  if (commonPasswords) return commonPasswords
  let text = ''
  try {
    text = fs.readFileSync(passwordListFile(), 'utf8')
  } catch {
    throw new KeyError('PASSWORD_COMMON')
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'))
  if (lines.length < 1000) throw new KeyError('PASSWORD_COMMON')
  commonPasswords = new Set(lines.map(asciiFold))
  return commonPasswords
}

/** NFKC UTF-8 bytes for a new password. Unlock does not use this; a later list must not lock the file. */
export function passwordBytes(password: string, confirm: string): Buffer {
  const normalized = password.normalize('NFKC')
  const points = Array.from(normalized)
  if (points.length < 10 || normalized.trim().length === 0 || normalized.includes('\0')) throw new KeyError('PASSWORD_TOO_SHORT')
  if (points.length > 128) throw new KeyError('PASSWORD_TOO_LONG')
  const bytes = Buffer.from(normalized, 'utf8')
  if (bytes.length > 512) {
    bytes.fill(0)
    throw new KeyError('PASSWORD_TOO_LONG')
  }
  const confirmed = Buffer.from(confirm.normalize('NFKC'), 'utf8')
  try {
    if (confirmed.length !== bytes.length || !timingSafeEqual(confirmed, bytes)) throw new KeyError('PASSWORD_MISMATCH')
  } finally {
    confirmed.fill(0)
  }
  if (loadCommonPasswords().has(asciiFold(normalized))) {
    bytes.fill(0)
    throw new KeyError('PASSWORD_COMMON')
  }
  return bytes
}

export function buffersEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

export function utf8Password(password: string): Buffer {
  return Buffer.from(password.normalize('NFKC'), 'utf8')
}

export async function deriveAdminKek(password: Buffer, params: ArgonParams): Promise<Buffer> {
  kdfHooks.onDerive?.({
    memoryKib: params.memoryKib,
    iterations: params.iterations,
    parallelism: params.parallelism,
    slotIndex: params.slotIndex,
  })
  const associatedData = Buffer.concat([Buffer.from(ADMIN_AD, 'ascii'), Buffer.from([params.slotIndex, params.slotType])])
  try {
    const kek = await argon2.hash(password, {
      raw: true,
      type: argon2.argon2id,
      version: 0x13,
      memoryCost: params.memoryKib,
      timeCost: params.iterations,
      parallelism: params.parallelism,
      salt: params.salt,
      hashLength: 32,
      associatedData,
    })
    kdfHooks.onKek?.(kek)
    return kek
  } catch (error) {
    if (error instanceof KeyError) throw error
    throw new KeyError('UNLOCK_FAILED')
  } finally {
    associatedData.fill(0)
  }
}

export function deriveRecoveryKek(secret: Buffer, salt: Buffer, slotIndex: number, slotType: number): Buffer {
  if (secret.length < 16) throw new KeyError('RECOVERY_KEY_CHECKSUM')
  kdfHooks.onHkdf?.()
  const info = Buffer.concat([Buffer.from(RECOVERY_AD, 'ascii'), Buffer.from([slotIndex, slotType])])
  try {
    return Buffer.from(hkdfSync('sha256', secret, salt, info, 32))
  } finally {
    info.fill(0)
  }
}

export function encodeCrockford(data: Buffer): string {
  let value = 0
  let bits = 0
  let out = ''
  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += CROCKFORD[(value >> bits) & 31]
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out
}

export function decodeCrockford(text: string): Buffer | null {
  let value = 0
  let bits = 0
  const out: number[] = []
  for (const char of text) {
    const index = CROCKFORD.indexOf(char)
    if (index < 0) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 255)
    }
  }
  if (bits !== 0) return null
  return Buffer.from(out)
}

function checksumChars(secret: Buffer): string {
  const digest = createHash('sha256').update(CHECKSUM_LABEL, 'ascii').update(secret).digest()
  const bits = ((digest[0] ?? 0) << 12) | ((digest[1] ?? 0) << 4) | ((digest[2] ?? 0) >> 4)
  let out = ''
  for (let shift = 15; shift >= 0; shift -= 5) out += CROCKFORD[(bits >> shift) & 31]
  return out
}

export function formatRecoveryKey(secret: Buffer): string {
  if (secret.length !== 20) throw new KeyError('RECOVERY_KEY_CHECKSUM')
  const body = encodeCrockford(secret)
  const groups = body.match(/.{4}/g)
  if (!groups || groups.length !== 8) throw new KeyError('RECOVERY_KEY_CHECKSUM')
  return `${groups.join('-')}-${checksumChars(secret)}`
}

export function normalizeRecoveryText(input: string): string {
  return input.replace(/[ \t\r\n-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V')
}

/** Raw 20-byte secret, or a checksum failure. Does not run HKDF. */
export function parseRecoveryKey(input: string): Buffer {
  const text = normalizeRecoveryText(input)
  if (text.length !== 36) throw new KeyError('RECOVERY_KEY_CHECKSUM')
  const secret = decodeCrockford(text.slice(0, 32))
  if (!secret || secret.length !== 20) throw new KeyError('RECOVERY_KEY_CHECKSUM')
  const expected = Buffer.from(checksumChars(secret), 'ascii')
  const actual = Buffer.from(text.slice(32), 'ascii')
  try {
    if (!timingSafeEqual(expected, actual)) throw new KeyError('RECOVERY_KEY_CHECKSUM')
  } catch (error) {
    secret.fill(0)
    if (error instanceof KeyError) throw error
    throw new KeyError('RECOVERY_KEY_CHECKSUM')
  } finally {
    expected.fill(0)
    actual.fill(0)
  }
  return secret
}

export function drawDistinct(size: number, existing: Buffer[]): Buffer {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = keyRandom.bytes(size)
    if (!existing.some((item) => item.length === bytes.length && item.equals(bytes))) return bytes
    bytes.fill(0)
  }
  throw new KeyError('FILE_HEADER_INVALID')
}

export const BASELINE_ARGON = { memoryKib: 65536, iterations: 3, parallelism: 1 } as const
