// SPDX-License-Identifier: AGPL-3.0-only
import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { KeyError } from './errors.js'

export const ENVELOPE_BYTES = 320
export const PREFIX_BYTES = 32
export const SLOT_BYTES = 96
export const SLOT_COUNT = 3
export const SLOT_OFFSETS = [32, 128, 224] as const

const MAGIC = Buffer.from('ERTK')

export interface SlotMaterial {
  index: 0 | 1 | 2
  type: 1 | 2
  kdfId: 1 | 2
  argonVersion: number
  memoryKib: number
  iterations: number
  parallelism: number
  salt: Buffer
  nonce: Buffer
}

export interface ParsedSlot extends SlotMaterial {
  ciphertext: Buffer
  tag: Buffer
}

export interface ParsedEnvelope {
  fileId: Buffer
  keyGeneration: number
  prefix: Buffer
  slots: [ParsedSlot, ParsedSlot, ParsedSlot]
}

export interface EnvelopeIdentity {
  fileId: string
  keyGeneration: number
}

function copy(bytes: Buffer, offset: number, length: number): Buffer {
  const out = Buffer.alloc(length)
  bytes.copy(out, 0, offset, offset + length)
  return out
}

/** File id and generation from a 320-byte envelope. Returns null when the header is not that file. */
export function readEnvelopeIdentity(bytes: Buffer): EnvelopeIdentity | null {
  if (bytes.length !== ENVELOPE_BYTES || !bytes.subarray(0, 4).equals(MAGIC)) return null
  if (bytes.readUInt16BE(4) !== 1 || bytes.readUInt16BE(6) !== ENVELOPE_BYTES) return null
  return { fileId: bytes.subarray(8, 24).toString('hex'), keyGeneration: bytes.readUInt32BE(26) }
}

export function allocateEnvelope(fileId: Buffer, keyGeneration: number, slots: SlotMaterial[]): Buffer {
  if (fileId.length !== 16 || !Number.isInteger(keyGeneration) || keyGeneration < 1) throw new KeyError('FILE_HEADER_INVALID')
  if (slots.length !== SLOT_COUNT || slots.some((slot, position) => slot.index !== position)) throw new KeyError('FILE_HEADER_INVALID')
  const bytes = Buffer.alloc(ENVELOPE_BYTES)
  MAGIC.copy(bytes, 0)
  bytes.writeUInt16BE(1, 4)
  bytes.writeUInt16BE(ENVELOPE_BYTES, 6)
  fileId.copy(bytes, 8)
  bytes.writeUInt8(SLOT_COUNT, 24)
  bytes.writeUInt32BE(keyGeneration, 26)
  for (const slot of slots) writeSlotHeader(bytes, slot)
  return bytes
}

function writeSlotHeader(bytes: Buffer, slot: SlotMaterial): void {
  if (slot.salt.length !== 16 || slot.nonce.length !== 12) throw new KeyError('FILE_HEADER_INVALID')
  const offset = SLOT_OFFSETS[slot.index]
  bytes.writeUInt8(slot.index, offset)
  bytes.writeUInt8(slot.type, offset + 1)
  bytes.writeUInt8(slot.kdfId, offset + 2)
  bytes.writeUInt8(slot.argonVersion, offset + 3)
  bytes.writeUInt32BE(slot.memoryKib, offset + 4)
  bytes.writeUInt32BE(slot.iterations, offset + 8)
  bytes.writeUInt32BE(slot.parallelism, offset + 12)
  bytes.writeUInt8(16, offset + 16)
  bytes.writeUInt8(12, offset + 17)
  bytes.writeUInt8(16, offset + 18)
  slot.salt.copy(bytes, offset + 20)
  slot.nonce.copy(bytes, offset + 36)
}

function associatedData(bytes: Buffer, slotIndex: number): Buffer {
  const offset = SLOT_OFFSETS[slotIndex]
  return Buffer.concat([bytes.subarray(0, PREFIX_BYTES), bytes.subarray(offset, offset + 48)])
}

export function sealSlot(bytes: Buffer, slotIndex: 0 | 1 | 2, kek: Buffer, dek: Buffer): void {
  const offset = SLOT_OFFSETS[slotIndex]
  const nonce = bytes.subarray(offset + 36, offset + 48)
  const cipher = createCipheriv('aes-256-gcm', kek, nonce)
  cipher.setAAD(associatedData(bytes, slotIndex))
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()
  try {
    if (ciphertext.length !== 32 || tag.length !== 16) throw new KeyError('FILE_HEADER_INVALID')
    ciphertext.copy(bytes, offset + 48)
    tag.copy(bytes, offset + 80)
  } finally {
    ciphertext.fill(0)
    tag.fill(0)
  }
}

export function openSlot(bytes: Buffer, slotIndex: number, kek: Buffer): Buffer {
  const offset = SLOT_OFFSETS[slotIndex]
  const nonce = bytes.subarray(offset + 36, offset + 48)
  const ciphertext = bytes.subarray(offset + 48, offset + 80)
  const tag = bytes.subarray(offset + 80, offset + 96)
  const decipher = createDecipheriv('aes-256-gcm', kek, nonce)
  decipher.setAAD(associatedData(bytes, slotIndex))
  decipher.setAuthTag(tag)
  const parts: Buffer[] = []
  try {
    parts.push(decipher.update(ciphertext))
    parts.push(decipher.final())
    return Buffer.concat(parts)
  } catch {
    throw new KeyError('UNLOCK_FAILED')
  } finally {
    for (const part of parts) part.fill(0)
  }
}

function slotParamsRejected(slot: ParsedSlot): boolean {
  if (slot.salt.length !== 16 || slot.tag.length !== 16) return true
  if (slot.index === 2 || slot.type === 2) {
    return slot.type !== 2
      || slot.kdfId !== 2
      || slot.argonVersion !== 0
      || slot.memoryKib !== 0
      || slot.iterations !== 0
      || slot.parallelism !== 0
  }
  return slot.type !== 1
    || slot.kdfId !== 1
    || slot.argonVersion !== 0x13
    || slot.memoryKib < 65536
    || slot.memoryKib > 262144
    || slot.iterations < 3
    || slot.iterations > 16
    || slot.parallelism < 1
    || slot.parallelism > 4
}

export function parseEnvelope(bytes: Buffer): ParsedEnvelope {
  if (bytes.length !== ENVELOPE_BYTES || !bytes.subarray(0, 4).equals(MAGIC)) throw new KeyError('FILE_HEADER_INVALID')
  if (bytes.readUInt16BE(4) !== 1 || bytes.readUInt16BE(6) !== ENVELOPE_BYTES) throw new KeyError('FILE_HEADER_INVALID')
  if (bytes.readUInt8(24) !== SLOT_COUNT || bytes.readUInt8(25) !== 0 || bytes.readUInt16BE(30) !== 0) throw new KeyError('FILE_HEADER_INVALID')
  const keyGeneration = bytes.readUInt32BE(26)
  if (keyGeneration < 1) throw new KeyError('FILE_HEADER_INVALID')
  const slots = SLOT_OFFSETS.map((offset, position) => readSlot(bytes, offset, position))
  if (slots.length !== 3) throw new KeyError('FILE_HEADER_INVALID')
  const nonces = slots.map((slot) => slot.nonce)
  for (let i = 0; i < nonces.length; i++) {
    for (let j = i + 1; j < nonces.length; j++) {
      if (nonces[i]!.equals(nonces[j]!)) throw new KeyError('FILE_HEADER_INVALID')
    }
  }
  const parsed = slots as [ParsedSlot, ParsedSlot, ParsedSlot]
  if (parsed.some((slot) => slot.nonce.length !== 12)) throw new KeyError('FILE_HEADER_INVALID')
  if (parsed.some(slotParamsRejected)) throw new KeyError('KEY_PARAMS_REJECTED')
  return { fileId: copy(bytes, 8, 16), keyGeneration, prefix: copy(bytes, 0, PREFIX_BYTES), slots: parsed }
}

function readSlot(bytes: Buffer, offset: number, position: number): ParsedSlot {
  const index = bytes.readUInt8(offset)
  const nonceLen = bytes.readUInt8(offset + 17)
  if (index !== position || nonceLen !== 12 || bytes.readUInt8(offset + 19) !== 0) throw new KeyError('FILE_HEADER_INVALID')
  if (bytes.readUInt8(offset + 16) !== 16 || bytes.readUInt8(offset + 18) !== 16) throw new KeyError('KEY_PARAMS_REJECTED')
  const type = bytes.readUInt8(offset + 1)
  if (type !== 1 && type !== 2) throw new KeyError('FILE_HEADER_INVALID')
  return {
    index: index as 0 | 1 | 2,
    type: type as 1 | 2,
    kdfId: bytes.readUInt8(offset + 2) as 1 | 2,
    argonVersion: bytes.readUInt8(offset + 3),
    memoryKib: bytes.readUInt32BE(offset + 4),
    iterations: bytes.readUInt32BE(offset + 8),
    parallelism: bytes.readUInt32BE(offset + 12),
    salt: copy(bytes, offset + 20, 16),
    nonce: copy(bytes, offset + 36, 12),
    ciphertext: copy(bytes, offset + 48, 32),
    tag: copy(bytes, offset + 80, 16),
  }
}

export function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}
