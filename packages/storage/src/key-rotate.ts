// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import { type AppDb, rekeyDataFile } from './db.js'
import { KeyError } from './errors.js'
import { parseEnvelope } from './key-envelope.js'
import { keyFilePath, writePrivateBytes } from './key-file.js'
import { buffersEqual, formatRecoveryKey, passwordBytes, utf8Password } from './key-kdf.js'
import { keyRandom } from './key-random.js'
import { type ConfirmedPassword, sealEnvelope, unwrapAdminSlot } from './key-slots.js'
import { ensureKeyColumns, recordKeyAudit, setKeyGeneration, setTemporarySlot } from './schema.js'

export async function rotateDataKey(db: AppDb, options: {
  actingPassword: string
  other: { kind: 'password' | 'temporary'; password: ConfirmedPassword }
}): Promise<{ recoveryKey: Buffer }> {
  const session = db.keySession
  if (!session || session.kind !== 'admin' || (session.slotIndex !== 0 && session.slotIndex !== 1)) throw new KeyError('UNLOCK_FAILED')
  if (!db.dataKey) throw new KeyError('UNLOCK_FAILED')
  const actingSlot = session.slotIndex
  const otherSlot = actingSlot === 0 ? 1 : 0
  const acting = utf8Password(options.actingPassword)
  const other = passwordBytes(options.other.password.password, options.other.password.confirm)
  const nextDek = keyRandom.bytes(32)
  const secret = keyRandom.bytes(20)
  const recoveryKey = Buffer.from(formatRecoveryKey(secret), 'ascii')
  try {
    if (buffersEqual(acting, other)) throw new KeyError('PASSWORD_MISMATCH')
    const bytes = fs.readFileSync(keyFilePath(db.filePath))
    const parsed = parseEnvelope(bytes)
    const opened = await unwrapAdminSlot(bytes, parsed.slots[actingSlot], acting)
    try {
      if (!opened || !buffersEqual(opened, db.dataKey)) throw new KeyError('UNLOCK_FAILED')
    } finally {
      opened?.fill(0)
    }
    const fileIdHex = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id
    if (!fileIdHex) throw new KeyError('UNLOCK_FAILED')
    const generation = ensureKeyColumns(db.raw).keyGeneration + 1
    const passwords: [Buffer, Buffer] = actingSlot === 0 ? [acting, other] : [other, acting]
    const envelope = await sealEnvelope({
      dek: nextDek,
      fileId: Buffer.from(fileIdHex, 'hex'),
      keyGeneration: generation,
      passwords,
      recoverySecret: secret,
    })
    const reason = options.other.kind === 'temporary' ? 'temporary_password' : 'other_admin_present'
    rekeyDataFile(db, nextDek, {
      prepareCopy(copy) {
        setKeyGeneration(copy, generation)
        setTemporarySlot(copy, options.other.kind === 'temporary' ? otherSlot : null)
        recordKeyAudit(copy, 'dek_rotation', reason)
      },
      writeKeyFile(tempKey) {
        writePrivateBytes(tempKey, envelope)
      },
    })
    return { recoveryKey }
  } catch (error) {
    recoveryKey.fill(0)
    throw error
  } finally {
    acting.fill(0)
    other.fill(0)
    nextDek.fill(0)
    secret.fill(0)
  }
}
