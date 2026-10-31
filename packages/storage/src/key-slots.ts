// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fsyncDirectory, secureRemove } from './atomic.js'
import { type AppDb, initializeEncryptedFile, openDatabase } from './db.js'
import { KeyError, RaceFileError } from './errors.js'
import { beginAttempt, resetAttempts } from './key-backoff.js'
import { allocateEnvelope, type ParsedSlot, parseEnvelope, type SlotMaterial, sealSlot, SLOT_OFFSETS, openSlot } from './key-envelope.js'
import { BASELINE_ARGON, buffersEqual, deriveAdminKek, deriveRecoveryKek, drawDistinct, formatRecoveryKey, parseRecoveryKey, passwordBytes, utf8Password } from './key-kdf.js'
import { keyFilePath, rekeyTempPaths, writePrivateBytes } from './key-file.js'
import { logUnlock } from './key-log.js'
import { keyRandom } from './key-random.js'
import { ensureKeyColumns } from './schema.js'

export interface ConfirmedPassword {
  password: string
  confirm: string
}

export interface ArgonChoice {
  memoryKib: number
  iterations: number
  parallelism: number
}

export const keyHooks: {
  beforeAttach?: () => void
} = {}

interface HeldDek {
  index: 0 | 1
  dek: Buffer
}

function readKeyBytes(keyPath: string): Buffer {
  try {
    const bytes = fs.readFileSync(keyPath)
    if (bytes.length !== 320) throw new KeyError('FILE_HEADER_INVALID')
    return bytes
  } catch (error) {
    if (error instanceof KeyError) throw error
    throw new KeyError('FILE_HEADER_INVALID')
  }
}

function adminMaterial(index: 0 | 1, params: ArgonChoice, salt: Buffer, nonce: Buffer): SlotMaterial {
  return { index, type: 1, kdfId: 1, argonVersion: 0x13, memoryKib: params.memoryKib, iterations: params.iterations, parallelism: params.parallelism, salt, nonce }
}

function recoveryMaterial(salt: Buffer, nonce: Buffer): SlotMaterial {
  return { index: 2, type: 2, kdfId: 2, argonVersion: 0, memoryKib: 0, iterations: 0, parallelism: 0, salt, nonce }
}

function freshMaterial(existingSalts: Buffer[], existingNonces: Buffer[]): { salt: Buffer; nonce: Buffer } {
  return { salt: drawDistinct(16, existingSalts), nonce: drawDistinct(12, existingNonces) }
}

export async function sealEnvelope(input: {
  dek: Buffer
  fileId: Buffer
  keyGeneration: number
  passwords: [Buffer, Buffer]
  params?: [ArgonChoice, ArgonChoice]
  recoverySecret: Buffer
}): Promise<Buffer> {
  const params = input.params ?? [BASELINE_ARGON, BASELINE_ARGON]
  const salts: Buffer[] = []
  const nonces: Buffer[] = []
  for (let index = 0; index < 3; index++) {
    salts.push(drawDistinct(16, salts))
    nonces.push(drawDistinct(12, nonces))
  }
  const materials: SlotMaterial[] = [
    adminMaterial(0, params[0], salts[0]!, nonces[0]!),
    adminMaterial(1, params[1], salts[1]!, nonces[1]!),
    recoveryMaterial(salts[2]!, nonces[2]!),
  ]
  const bytes = allocateEnvelope(input.fileId, input.keyGeneration, materials)
  const keks: Buffer[] = []
  try {
    for (const index of [0, 1] as const) {
      const kek = await deriveAdminKek(input.passwords[index], {
        ...params[index],
        slotIndex: index,
        slotType: 1,
        salt: salts[index]!,
      })
      keks.push(kek)
      sealSlot(bytes, index, kek, input.dek)
    }
    const recoveryKek = deriveRecoveryKek(input.recoverySecret, salts[2]!, 2, 2)
    keks.push(recoveryKek)
    sealSlot(bytes, 2, recoveryKek, input.dek)
    return bytes
  } finally {
    for (const kek of keks) kek.fill(0)
  }
}

function removeRaceFiles(filePath: string): void {
  secureRemove(filePath)
  secureRemove(`${filePath}-wal`)
  secureRemove(`${filePath}-shm`)
  secureRemove(keyFilePath(filePath))
}

export async function createProtectedRaceFile(filePath: string, first: ConfirmedPassword, second: ConfirmedPassword): Promise<{ db: AppDb; recoveryKey: Buffer }> {
  const resolved = path.resolve(filePath)
  if (fs.existsSync(resolved)) throw new Error('Race file already exists')
  let firstBytes: Buffer | undefined
  let secondBytes: Buffer | undefined
  let dek: Buffer | undefined
  let fileId: Buffer | undefined
  let recoverySecret: Buffer | undefined
  let recoveryKey: Buffer | undefined
  let db: AppDb | undefined
  try {
    firstBytes = passwordBytes(first.password, first.confirm)
    secondBytes = passwordBytes(second.password, second.confirm)
    if (buffersEqual(firstBytes, secondBytes)) throw new KeyError('PASSWORD_MISMATCH')
    dek = keyRandom.bytes(32)
    fileId = keyRandom.bytes(16)
    recoverySecret = keyRandom.bytes(20)
    recoveryKey = Buffer.from(formatRecoveryKey(recoverySecret), 'ascii')
    const envelope = await sealEnvelope({
      dek,
      fileId,
      keyGeneration: 1,
      passwords: [firstBytes, secondBytes],
      recoverySecret,
    })
    db = initializeEncryptedFile(resolved, dek, fileId.toString('hex'), 1)
    writePrivateBytes(keyFilePath(resolved), envelope)
    db.keySession = { kind: 'admin', slotIndex: 0 }
    return { db, recoveryKey }
  } catch (error) {
    recoveryKey?.fill(0)
    try {
      db?.raw.close()
    } catch {
      // The handle may already be closed.
    }
    removeRaceFiles(resolved)
    throw error
  } finally {
    firstBytes?.fill(0)
    secondBytes?.fill(0)
    dek?.fill(0)
    fileId?.fill(0)
    recoverySecret?.fill(0)
  }
}

export async function unwrapAdminSlot(bytes: Buffer, slot: ParsedSlot, password: Buffer): Promise<Buffer | null> {
  let kek: Buffer | undefined
  try {
    kek = await deriveAdminKek(password, {
      memoryKib: slot.memoryKib,
      iterations: slot.iterations,
      parallelism: slot.parallelism,
      slotIndex: slot.index,
      slotType: slot.type,
      salt: slot.salt,
    })
    return openSlot(bytes, slot.index, kek)
  } catch {
    return null
  } finally {
    kek?.fill(0)
  }
}

async function finishOpen(filePath: string, envelope: Buffer, dek: Buffer, kind: 'password' | 'recovery', slotIndex: 0 | 1 | 2): Promise<AppDb> {
  let db: AppDb | undefined
  try {
    db = await openDatabase(filePath, { dataKey: dek })
    const parsed = parseEnvelope(envelope)
    const stored = db.get<{ file_id: string | null }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id ?? ''
    const fileId = Buffer.from(stored, 'hex')
    try {
      if (fileId.length !== parsed.fileId.length || !timingSafeEqual(fileId, parsed.fileId)) throw new KeyError('UNLOCK_FAILED')
    } finally {
      fileId.fill(0)
    }
    const columns = ensureKeyColumns(db.raw)
    const left = Buffer.alloc(4)
    const right = Buffer.alloc(4)
    left.writeUInt32BE(columns.keyGeneration)
    right.writeUInt32BE(parsed.keyGeneration)
    const generationOk = timingSafeEqual(left, right)
    left.fill(0)
    right.fill(0)
    if (!generationOk) throw new KeyError('UNLOCK_FAILED')
    if (db.raw.pragma('integrity_check', { simple: true }) !== 'ok') throw new KeyError('UNLOCK_FAILED')
    resetAttempts(filePath)
    if (kind === 'recovery') db.keySession = { kind: 'recovery-gate', slotIndex: 2 }
    else if (columns.temporarySlot === slotIndex) db.keySession = { kind: 'temporary-password', slotIndex }
    else db.keySession = { kind: 'admin', slotIndex: slotIndex as 0 | 1 }
    logUnlock('unlock ok', 0)
    keyHooks.beforeAttach?.()
    const opened = db
    db = undefined
    return opened
  } catch (error) {
    try {
      db?.raw.close()
    } catch {
      // The handle may already be closed.
    }
    if (error instanceof KeyError) throw error
    if (error instanceof RaceFileError && error.kind === 'newer') throw error
    throw new KeyError('UNLOCK_FAILED')
  }
}

function clearTemps(filePath: string): void {
  const temps = rekeyTempPaths(filePath)
  if (!fs.existsSync(temps.database) || !fs.existsSync(filePath)) return
  secureRemove(temps.database)
  secureRemove(`${temps.database}-wal`)
  secureRemove(`${temps.database}-shm`)
  secureRemove(temps.key)
}

async function withKeyFile(filePath: string, open: (keyPath: string) => Promise<AppDb>): Promise<AppDb> {
  clearTemps(filePath)
  const temps = rekeyTempPaths(filePath)
  const pending = fs.existsSync(temps.key) && fs.existsSync(filePath) && !fs.existsSync(temps.database)
  const db = await open(pending ? temps.key : keyFilePath(filePath))
  if (!pending || !fs.existsSync(temps.key)) return db
  fs.renameSync(temps.key, keyFilePath(filePath))
  fsyncDirectory(path.dirname(filePath))
  try {
    fs.chmodSync(keyFilePath(filePath), 0o600)
  } catch {
    // Permissions are best-effort on filesystems that ignore them.
  }
  return db
}

function refuseWait(filePath: string): void {
  const decision = beginAttempt(filePath)
  if (!decision.proceed) {
    logUnlock('unlock backoff', decision.failureCount)
    throw new KeyError('UNLOCK_FAILED', decision.retryAfterMs)
  }
}

export async function unlockWithPassword(filePath: string, password: string): Promise<AppDb> {
  return withKeyFile(filePath, (keyPath) => unlockPasswordAt(filePath, keyPath, password))
}

async function unlockPasswordAt(filePath: string, keyPath: string, password: string): Promise<AppDb> {
  const bytes = readKeyBytes(keyPath)
  const parsed = parseEnvelope(bytes)
  refuseWait(filePath)
  const passwordBuf = utf8Password(password)
  const opened: HeldDek[] = []
  try {
    for (const index of [0, 1] as const) {
      const dek = await unwrapAdminSlot(bytes, parsed.slots[index], passwordBuf)
      if (dek) opened.push({ index, dek })
    }
    const match = opened[0]
    if (!match) {
      logUnlock('unlock failed')
      throw new KeyError('UNLOCK_FAILED')
    }
    return await finishOpen(filePath, bytes, match.dek, 'password', match.index)
  } finally {
    passwordBuf.fill(0)
    for (const item of opened) item.dek.fill(0)
  }
}

export async function unlockWithRecovery(filePath: string, recoveryKey: string): Promise<AppDb> {
  return withKeyFile(filePath, (keyPath) => unlockRecoveryAt(filePath, keyPath, recoveryKey))
}

async function unlockRecoveryAt(filePath: string, keyPath: string, recoveryKey: string): Promise<AppDb> {
  const bytes = readKeyBytes(keyPath)
  const parsed = parseEnvelope(bytes)
  refuseWait(filePath)
  let secret: Buffer
  try {
    secret = parseRecoveryKey(recoveryKey)
  } catch (error) {
    if (error instanceof KeyError) logUnlock('unlock failed')
    throw error
  }
  let dek: Buffer | undefined
  try {
    const slot = parsed.slots[2]
    const kek = deriveRecoveryKek(secret, slot.salt, slot.index, slot.type)
    try {
      dek = openSlot(bytes, 2, kek)
    } finally {
      kek.fill(0)
    }
    return await finishOpen(filePath, bytes, dek, 'recovery', 2)
  } catch (error) {
    if (error instanceof KeyError && error.code === 'UNLOCK_FAILED') logUnlock('unlock failed')
    if (error instanceof KeyError) throw error
    logUnlock('unlock failed')
    throw new KeyError('UNLOCK_FAILED')
  } finally {
    secret.fill(0)
    dek?.fill(0)
  }
}

export function normalUseAllowed(db: AppDb): boolean {
  return db.keySession?.kind === 'admin'
}

function requireDek(db: AppDb): Buffer {
  if (!db.dataKey || db.dataKey.length !== 32) throw new KeyError('UNLOCK_FAILED')
  return db.dataKey
}

async function assertDistinctFromOther(bytes: Buffer, parsed: ReturnType<typeof parseEnvelope>, slot: 0 | 1, password: Buffer, dek: Buffer): Promise<void> {
  const other = slot === 0 ? 1 : 0
  const opened = await unwrapAdminSlot(bytes, parsed.slots[other], password)
  if (!opened) return
  try {
    if (buffersEqual(opened, dek)) throw new KeyError('PASSWORD_MISMATCH')
  } finally {
    opened.fill(0)
  }
}

function rewriteSlot(bytes: Buffer, slot: 0 | 1 | 2, material: SlotMaterial, kek: Buffer, dek: Buffer): Buffer {
  const parsed = parseEnvelope(bytes)
  const materials: SlotMaterial[] = parsed.slots.map((item) => ({
    index: item.index,
    type: item.type,
    kdfId: item.kdfId,
    argonVersion: item.argonVersion,
    memoryKib: item.memoryKib,
    iterations: item.iterations,
    parallelism: item.parallelism,
    salt: item.salt,
    nonce: item.nonce,
  }))
  materials[slot] = material
  const next = allocateEnvelope(parsed.fileId, parsed.keyGeneration, materials)
  for (const index of [0, 1, 2] as const) {
    if (index === slot) continue
    parsed.slots[index].ciphertext.copy(next, SLOT_OFFSETS[index] + 48)
    parsed.slots[index].tag.copy(next, SLOT_OFFSETS[index] + 80)
  }
  sealSlot(next, slot, kek, dek)
  return next
}

export async function rewrapAdminSlot(db: AppDb, slot: 0 | 1, next: ConfirmedPassword, currentPassword?: string): Promise<void> {
  const session = db.keySession
  if (!session || (session.kind !== 'admin' && session.kind !== 'recovery-gate' && session.kind !== 'temporary-password')) {
    throw new KeyError('UNLOCK_FAILED')
  }
  if (session.kind === 'temporary-password' && session.slotIndex !== slot) throw new KeyError('UNLOCK_FAILED')
  const dek = requireDek(db)
  const bytes = readKeyBytes(keyFilePath(db.filePath))
  const parsed = parseEnvelope(bytes)
  if (session.kind !== 'recovery-gate' && session.slotIndex === slot) {
    if (currentPassword === undefined) throw new KeyError('UNLOCK_FAILED')
    const current = utf8Password(currentPassword)
    try {
      const opened = await unwrapAdminSlot(bytes, parsed.slots[slot], current)
      try {
        if (!opened || !buffersEqual(opened, dek)) throw new KeyError('UNLOCK_FAILED')
      } finally {
        opened?.fill(0)
      }
    } finally {
      current.fill(0)
    }
  }
  const password = passwordBytes(next.password, next.confirm)
  try {
    await assertDistinctFromOther(bytes, parsed, slot, password, dek)
    const drawn = freshMaterial(parsed.slots.map((item) => item.salt), parsed.slots.map((item) => item.nonce))
    const kek = await deriveAdminKek(password, {
      ...BASELINE_ARGON,
      slotIndex: slot,
      slotType: 1,
      salt: drawn.salt,
    })
    try {
      const envelope = rewriteSlot(bytes, slot, adminMaterial(slot, BASELINE_ARGON, drawn.salt, drawn.nonce), kek, dek)
      writePrivateBytes(keyFilePath(db.filePath), envelope)
    } finally {
      kek.fill(0)
    }
    if (ensureKeyColumns(db.raw).temporarySlot === slot) setTemporaryClear(db)
    if (session.kind === 'recovery-gate' || session.slotIndex === slot) db.keySession = { kind: 'admin', slotIndex: slot }
  } finally {
    password.fill(0)
  }
}

function setTemporaryClear(db: AppDb): void {
  db.run('UPDATE schema_meta SET temporary_slot = NULL WHERE id = 1')
}

export async function regenerateRecoveryKey(db: AppDb): Promise<Buffer> {
  if (db.keySession?.kind !== 'admin') throw new KeyError('UNLOCK_FAILED')
  const dek = requireDek(db)
  const bytes = readKeyBytes(keyFilePath(db.filePath))
  const parsed = parseEnvelope(bytes)
  const secret = keyRandom.bytes(20)
  const shown = Buffer.from(formatRecoveryKey(secret), 'ascii')
  const drawn = freshMaterial(parsed.slots.map((item) => item.salt), parsed.slots.map((item) => item.nonce))
  const kek = deriveRecoveryKek(secret, drawn.salt, 2, 2)
  try {
    const envelope = rewriteSlot(bytes, 2, recoveryMaterial(drawn.salt, drawn.nonce), kek, dek)
    writePrivateBytes(keyFilePath(db.filePath), envelope)
    return shown
  } catch (error) {
    shown.fill(0)
    throw error
  } finally {
    secret.fill(0)
    kek.fill(0)
  }
}
