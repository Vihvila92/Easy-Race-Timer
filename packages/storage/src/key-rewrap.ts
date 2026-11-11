// SPDX-License-Identifier: AGPL-3.0-only
import type { AppDb, KeySession } from './db.js'
import { KeyError } from './errors.js'
import { allocateEnvelope, type ParsedEnvelope, type ParsedSlot, parseEnvelope, sealSlot, SLOT_OFFSETS, type SlotMaterial } from './key-envelope.js'
import { keyFilePath, withKeyFileLock, writePrivateBytes } from './key-file.js'
import { BASELINE_ARGON, buffersEqual, deriveAdminKek, deriveRecoveryKek, formatRecoveryKey, passwordBytes, utf8Password } from './key-kdf.js'
import { keyRandom } from './key-random.js'
import { ensureKeyColumns, issueRecoveryGeneration, setRecoveryUnshown } from './schema.js'
import { beginAttempt, resetAttempts } from './key-backoff.js'
import { adminMaterial, freshMaterial, readKeyBytes, recoveryMaterial, unwrapAdminSlot, type ConfirmedPassword } from './key-slots.js'

function requireDek(db: AppDb): Buffer {
  if (!db.dataKey || db.dataKey.length !== 32) throw new KeyError('UNLOCK_FAILED')
  return db.dataKey
}

/** Copy inside the key-file lock so a rotation cannot swap the key underneath a writer. */
function copyDek(db: AppDb): Buffer {
  return Buffer.from(requireDek(db))
}

function requireRewrapSession(db: AppDb, slot: 0 | 1): KeySession {
  const session = db.keySession
  if (session?.kind === 'recovery-unshown') throw new KeyError('RECOVERY_UNACKNOWLEDGED')
  if (session?.kind === 'admin' || session?.kind === 'recovery-gate') return session
  if (session?.kind === 'temporary-password' && session.slotIndex === slot) return session
  throw new KeyError('UNLOCK_FAILED')
}

function mustConfirmCurrent(session: KeySession, slot: 0 | 1): boolean {
  return session.kind !== 'recovery-gate' && session.slotIndex === slot
}

async function confirmCurrent(bytes: Buffer, slot: ParsedSlot, password: string, dek: Buffer): Promise<void> {
  const current = utf8Password(password)
  try {
    const opened = await unwrapAdminSlot(bytes, slot, current)
    const matches = Boolean(opened && buffersEqual(opened, dek))
    if (opened) opened.fill(0)
    if (!matches) throw new KeyError('UNLOCK_FAILED')
  } finally {
    current.fill(0)
  }
}

async function assertDistinctFromOther(input: {
  bytes: Buffer
  parsed: ParsedEnvelope
  slot: 0 | 1
  password: Buffer
  dek: Buffer
}): Promise<void> {
  const other = input.slot === 0 ? 1 : 0
  const opened = await unwrapAdminSlot(input.bytes, input.parsed.slots[other], input.password)
  if (!opened) return
  try {
    if (buffersEqual(opened, input.dek)) throw new KeyError('PASSWORD_MISMATCH')
  } finally {
    opened.fill(0)
  }
}

function rewriteSlot(input: { bytes: Buffer; slot: 0 | 1 | 2; material: SlotMaterial; kek: Buffer; dek: Buffer }): Buffer {
  const parsed = parseEnvelope(input.bytes)
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
  materials[input.slot] = input.material
  const next = allocateEnvelope(parsed.fileId, parsed.keyGeneration, materials)
  for (const index of [0, 1, 2] as const) {
    if (index === input.slot) continue
    parsed.slots[index].ciphertext.copy(next, SLOT_OFFSETS[index] + 48)
    parsed.slots[index].tag.copy(next, SLOT_OFFSETS[index] + 80)
  }
  sealSlot(next, input.slot, input.kek, input.dek)
  return next
}

function clearTemporary(db: AppDb): void {
  db.run('UPDATE schema_meta SET temporary_slot = NULL WHERE id = 1')
}

async function writeAdminEnvelope(input: {
  db: AppDb
  bytes: Buffer
  parsed: ParsedEnvelope
  slot: 0 | 1
  password: Buffer
  dek: Buffer
}): Promise<void> {
  const drawn = freshMaterial(input.parsed.slots.map((item) => item.salt), input.parsed.slots.map((item) => item.nonce))
  const kek = await deriveAdminKek(input.password, { ...BASELINE_ARGON, slotIndex: input.slot, slotType: 1, salt: drawn.salt })
  try {
    const envelope = rewriteSlot({
      bytes: input.bytes,
      slot: input.slot,
      material: adminMaterial(input.slot, BASELINE_ARGON, drawn.salt, drawn.nonce),
      kek,
      dek: input.dek,
    })
    writePrivateBytes(keyFilePath(input.db.filePath), envelope)
    if (ensureKeyColumns(input.db.raw).temporarySlot === input.slot) clearTemporary(input.db)
  } finally {
    kek.fill(0)
  }
}

async function rewrapLocked(input: {
  db: AppDb
  session: KeySession
  slot: 0 | 1
  next: ConfirmedPassword
  currentPassword?: string
  dek: Buffer
}): Promise<void> {
  const bytes = readKeyBytes(keyFilePath(input.db.filePath))
  const parsed = parseEnvelope(bytes)
  if (mustConfirmCurrent(input.session, input.slot)) {
    if (input.currentPassword === undefined) throw new KeyError('UNLOCK_FAILED')
    await confirmCurrent(bytes, parsed.slots[input.slot], input.currentPassword, input.dek)
  }
  const password = passwordBytes(input.next.password, input.next.confirm)
  try {
    await assertDistinctFromOther({ bytes, parsed, slot: input.slot, password, dek: input.dek })
    await writeAdminEnvelope({ db: input.db, bytes, parsed, slot: input.slot, password, dek: input.dek })
    if (ensureKeyColumns(input.db.raw).recoveryUnshown) {
      input.db.keySession = { kind: 'recovery-unshown', slotIndex: input.slot }
    } else if (input.session.kind === 'recovery-gate' || input.session.slotIndex === input.slot) {
      input.db.keySession = { kind: 'admin', slotIndex: input.slot }
    }
  } finally {
    password.fill(0)
  }
}

function countAttempt(filePath: string): void {
  const decision = beginAttempt(filePath)
  if (!decision.proceed) throw new KeyError('UNLOCK_FAILED', decision.retryAfterMs)
}

/** Check the acting admin's password. A wrong password shares the unlock backoff. */
export async function confirmActingPassword(db: AppDb, password: string): Promise<void> {
  const slot = db.keySession?.slotIndex
  if (slot !== 0 && slot !== 1) throw new KeyError('UNLOCK_FAILED')
  countAttempt(db.filePath)
  const dek = copyDek(db)
  try {
    const bytes = readKeyBytes(keyFilePath(db.filePath))
    await confirmCurrent(bytes, parseEnvelope(bytes).slots[slot], password, dek)
    resetAttempts(db.filePath)
  } finally {
    dek.fill(0)
  }
}

/** Replace one admin wrap. The read and the write share one in-process key-file lock. */
export async function rewrapAdminSlot(db: AppDb, slot: 0 | 1, next: ConfirmedPassword, currentPassword?: string): Promise<void> {
  const session = requireRewrapSession(db, slot)
  await withKeyFileLock(keyFilePath(db.filePath), async () => {
    const dek = copyDek(db)
    try {
      await rewrapLocked({ db, session, slot, next, currentPassword, dek })
    } finally {
      dek.fill(0)
    }
  })
}

export interface IssuedRecoveryKey {
  recoveryKey: Buffer
  /** Id of this issue. Not key material. */
  generation: number
}

/** Test seam. Production never sets these. A throw stands in for a crash between the two writes. */
export const recoveryHooks: {
  afterFlag?: () => void
  afterEnvelope?: () => void
} = {}

function blockUntilShown(db: AppDb): void {
  const session = db.keySession
  if (session?.kind === 'admin') db.keySession = { kind: 'recovery-unshown', slotIndex: session.slotIndex }
}

/** Flag first, then the envelope, so a crash cannot drop the only remaining key without a warning. */
function persistUnshownKey(db: AppDb, envelope: Buffer): number {
  const generation = issueRecoveryGeneration(db.raw)
  db.raw.pragma('wal_checkpoint(TRUNCATE)')
  blockUntilShown(db)
  recoveryHooks.afterFlag?.()
  writePrivateBytes(keyFilePath(db.filePath), envelope)
  recoveryHooks.afterEnvelope?.()
  return generation
}

async function regenerateLocked(db: AppDb, dek: Buffer): Promise<IssuedRecoveryKey> {
  const bytes = readKeyBytes(keyFilePath(db.filePath))
  const parsed = parseEnvelope(bytes)
  const secret = keyRandom.bytes(20)
  const shown = Buffer.from(formatRecoveryKey(secret), 'ascii')
  const drawn = freshMaterial(parsed.slots.map((item) => item.salt), parsed.slots.map((item) => item.nonce))
  const kek = deriveRecoveryKek(secret, drawn.salt, 2, 2)
  try {
    const envelope = rewriteSlot({ bytes, slot: 2, material: recoveryMaterial(drawn.salt, drawn.nonce), kek, dek })
    return { recoveryKey: shown, generation: persistUnshownKey(db, envelope) }
  } catch (error) {
    shown.fill(0)
    throw error
  } finally {
    secret.fill(0)
    kek.fill(0)
  }
}

function mayRegenerate(db: AppDb): boolean {
  const kind = db.keySession?.kind
  return kind === 'admin' || kind === 'recovery-unshown'
}

/** Replace the recovery wrap. The read and the write share one in-process key-file lock. */
export async function regenerateRecoveryKey(db: AppDb): Promise<IssuedRecoveryKey> {
  if (!mayRegenerate(db)) throw new KeyError('UNLOCK_FAILED')
  return withKeyFileLock(keyFilePath(db.filePath), async () => {
    const dek = copyDek(db)
    try {
      const shown = await regenerateLocked(db, dek)
      db.recoveryKeyIssued = true
      return shown
    } finally {
      dek.fill(0)
    }
  })
}

function clearShownFlag(db: AppDb): void {
  setRecoveryUnshown(db.raw, false)
  db.recoveryKeyIssued = false
  const session = db.keySession
  if (session?.kind === 'recovery-unshown' && session.slotIndex !== 2) {
    db.keySession = { kind: 'admin', slotIndex: session.slotIndex }
  }
}

/** Clear the unshown flag only when `generation` is still the newest issue. */
export async function acknowledgeRecoveryKeyShown(db: AppDb, generation: number): Promise<void> {
  if (!db.recoveryKeyIssued || !Number.isInteger(generation) || generation < 1) throw new KeyError('UNLOCK_FAILED')
  await withKeyFileLock(keyFilePath(db.filePath), async () => {
    if (ensureKeyColumns(db.raw).recoveryGeneration !== generation) throw new KeyError('UNLOCK_FAILED')
    clearShownFlag(db)
  })
}
