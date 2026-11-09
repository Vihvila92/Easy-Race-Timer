// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import { type AppDb, rekeyDataFile } from './db.js'
import { KeyError } from './errors.js'
import { type ParsedSlot, parseEnvelope } from './key-envelope.js'
import { keyFilePath, withKeyFileLock, writePrivateBytes } from './key-file.js'
import { buffersEqual, formatRecoveryKey, passwordBytes, utf8Password } from './key-kdf.js'
import { keyRandom } from './key-random.js'
import { type ConfirmedPassword, sealEnvelope, unwrapAdminSlot } from './key-slots.js'
import { ensureKeyColumns, issueRecoveryGeneration, recordKeyAudit, setKeyGeneration, setTemporarySlot } from './schema.js'

function requireActingAdmin(db: AppDb): 0 | 1 {
  const session = db.keySession
  if (session?.kind !== 'admin') throw new KeyError('UNLOCK_FAILED')
  if (session.slotIndex !== 0 && session.slotIndex !== 1) throw new KeyError('UNLOCK_FAILED')
  if (!db.dataKey) throw new KeyError('UNLOCK_FAILED')
  return session.slotIndex
}

async function confirmActing(bytes: Buffer, slot: ParsedSlot, password: Buffer, dek: Buffer): Promise<void> {
  const opened = await unwrapAdminSlot(bytes, slot, password)
  const matches = Boolean(opened && buffersEqual(opened, dek))
  if (opened) opened.fill(0)
  if (!matches) throw new KeyError('UNLOCK_FAILED')
}

function zeroBuffers(buffers: Buffer[]): void {
  for (const buffer of buffers) buffer.fill(0)
}

async function sealRotation(input: {
  db: AppDb
  actingSlot: 0 | 1
  acting: Buffer
  other: Buffer
  otherKind: 'password' | 'temporary'
  nextDek: Buffer
  secret: Buffer
}): Promise<number> {
  const bytes = fs.readFileSync(keyFilePath(input.db.filePath))
  const parsed = parseEnvelope(bytes)
  const dek = input.db.dataKey
  if (!dek) throw new KeyError('UNLOCK_FAILED')
  await confirmActing(bytes, parsed.slots[input.actingSlot], input.acting, dek)
  const fileIdHex = input.db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id
  if (!fileIdHex) throw new KeyError('UNLOCK_FAILED')
  const otherSlot = input.actingSlot === 0 ? 1 : 0
  const generation = ensureKeyColumns(input.db.raw).keyGeneration + 1
  const passwords: [Buffer, Buffer] = input.actingSlot === 0 ? [input.acting, input.other] : [input.other, input.acting]
  const envelope = await sealEnvelope({
    dek: input.nextDek,
    fileId: Buffer.from(fileIdHex, 'hex'),
    keyGeneration: generation,
    passwords,
    recoverySecret: input.secret,
  })
  const reason = input.otherKind === 'temporary' ? 'temporary_password' : 'other_admin_present'
  let recoveryGeneration = 0
  rekeyDataFile(input.db, input.nextDek, {
    prepareCopy(copy) {
      setKeyGeneration(copy, generation)
      setTemporarySlot(copy, input.otherKind === 'temporary' ? otherSlot : null)
      recoveryGeneration = issueRecoveryGeneration(copy)
      recordKeyAudit(copy, 'dek_rotation', reason)
    },
    writeKeyFile(tempKey) {
      writePrivateBytes(tempKey, envelope)
    },
  })
  return recoveryGeneration
}

export async function rotateDataKey(db: AppDb, options: {
  actingPassword: string
  other: { kind: 'password' | 'temporary'; password: ConfirmedPassword }
}): Promise<{ recoveryKey: Buffer; generation: number }> {
  const actingSlot = requireActingAdmin(db)
  const acting = utf8Password(options.actingPassword)
  const other = passwordBytes(options.other.password.password, options.other.password.confirm)
  const nextDek = keyRandom.bytes(32)
  const secret = keyRandom.bytes(20)
  const recoveryKey = Buffer.from(formatRecoveryKey(secret), 'ascii')
  try {
    if (buffersEqual(acting, other)) throw new KeyError('PASSWORD_MISMATCH')
    const generation = await withKeyFileLock(keyFilePath(db.filePath), () => sealRotation({ db, actingSlot, acting, other, otherKind: options.other.kind, nextDek, secret }))
    db.recoveryKeyIssued = true
    const session = db.keySession
    if (session?.kind === 'admin') db.keySession = { kind: 'recovery-unshown', slotIndex: session.slotIndex }
    return { recoveryKey, generation }
  } catch (error) {
    recoveryKey.fill(0)
    throw error
  } finally {
    zeroBuffers([acting, other, nextDek, secret])
  }
}
