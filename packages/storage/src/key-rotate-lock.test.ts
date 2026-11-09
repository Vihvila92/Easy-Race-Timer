// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KeyError } from './errors.js'
import { setKeyLogger } from './key-log.js'
import { keyFilePath } from './key-file.js'
import { acknowledgeRecoveryKeyShown, regenerateRecoveryKey, rewrapAdminSlot } from './key-rewrap.js'
import { rotateDataKey } from './key-rotate.js'
import { createProtectedRaceFile, normalUseAllowed, unlockWithPassword, unlockWithRecovery } from './key-slots.js'

const ADMIN_A = 'correct-horse-battery'
const ADMIN_B = 'staple-river-margin'
const OTHER = 'other-admin-present-now'
const CHANGED = 'changed-during-rotation'
const dirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-rotate-lock-'))
  dirs.push(dir)
  return path.join(dir, 'ert.sqlite')
}

afterEach(() => {
  setKeyLogger(null)
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function created() {
  const file = tempFile()
  const db = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
  return { file, db: db.db }
}

function generation(file: string): number {
  return fs.readFileSync(keyFilePath(file)).readUInt32BE(26)
}

const BELONGS = 'This key file does not belong to this race file. Use the key file that was saved together with the race file.'

describe('key file mismatch', () => {
  it('follows a correct password, counts the attempt, and names no secret', async () => {
    const { file, db } = await created()
    const fileId = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id ?? ''
    db.raw.close()
    const logs: string[] = []
    setKeyLogger((event) => logs.push(event))
    const wrong = await unlockWithPassword(file, 'not-the-admin-password').then(() => null, (error: unknown) => error)
    expect(wrong).toMatchObject({ code: 'UNLOCK_FAILED' })
    const matched = await unlockWithPassword(file, ADMIN_A)
    matched.run('UPDATE schema_meta SET key_generation = 2 WHERE id = 1')
    matched.raw.close()
    const mismatch = await unlockWithPassword(file, ADMIN_A).then(() => null, (error: unknown) => error)
    expect(mismatch).toBeInstanceOf(KeyError)
    const keyError = mismatch as KeyError
    expect(keyError.code).toBe('KEY_FILE_MISMATCH')
    expect(keyError.message).toBe(BELONGS)
    expect(keyError.message).not.toContain(file)
    expect(keyError.message).not.toContain(fileId)
    expect(JSON.stringify(keyError)).not.toContain(fileId)
    const captured = logs.join('\n')
    expect(captured).not.toContain(file)
    expect(captured).not.toContain(ADMIN_A)
    expect(captured).not.toContain(fileId)
    const record = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
    expect(record.failureCount).toBe(1)
    setKeyLogger(null)
  })
})

describe('rotation lock', () => {
  it('keeps the key file and the database on the same generation when a password change starts during rotation', async () => {
    const { file, db } = await created()
    const rotation = rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'temporary', password: { password: OTHER, confirm: OTHER } } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await Promise.all([
      rotation,
      rewrapAdminSlot(db, 1, { password: CHANGED, confirm: CHANGED }),
    ])
    const stored = db.get<{ key_generation: number }>('SELECT key_generation FROM schema_meta WHERE id = 1')?.key_generation
    expect(generation(file)).toBe(stored)
    db.raw.close()
    const mismatch = tempFile()
    const made = await createProtectedRaceFile(mismatch, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    made.db.run('UPDATE schema_meta SET key_generation = 2 WHERE id = 1')
    made.db.raw.close()
    await expect(unlockWithPassword(mismatch, ADMIN_A)).rejects.toMatchObject({ code: 'KEY_FILE_MISMATCH' })
    const changed = await unlockWithPassword(file, CHANGED)
    expect(changed.get('SELECT key_generation FROM schema_meta WHERE id = 1')).toEqual({ key_generation: stored })
    changed.raw.close()
    const acting = await unlockWithPassword(file, ADMIN_A)
    acting.raw.close()
  })
})

describe('serialized recovery keys', () => {
  it('keeps the later recovery key when two rotations overlap', async () => {
    const { file, db } = await created()
    const first = rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: 'first-rotation-password', confirm: 'first-rotation-password' } } })
    const second = rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: 'second-rotation-password', confirm: 'second-rotation-password' } } })
    const [older, newer] = await Promise.all([first, second])
    db.raw.close()
    await expect(unlockWithRecovery(file, older.recoveryKey.toString('ascii'))).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const opened = await unlockWithRecovery(file, newer.recoveryKey.toString('ascii'))
    opened.raw.close()
    older.recoveryKey.fill(0)
    newer.recoveryKey.fill(0)
  })

  it('keeps the regenerated recovery key when it overlaps a rotation', async () => {
    const { file, db } = await created()
    const rotation = rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: OTHER, confirm: OTHER } } })
    const regenerated = regenerateRecoveryKey(db)
    const [rotated, shown] = await Promise.all([rotation, regenerated])
    db.raw.close()
    await expect(unlockWithRecovery(file, rotated.recoveryKey.toString('ascii'))).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const opened = await unlockWithRecovery(file, shown.toString('ascii'))
    opened.raw.close()
    rotated.recoveryKey.fill(0)
    shown.fill(0)
  })
})

describe('unshown recovery key', () => {
  it('requires a new recovery key when rotation died before the key was shown', async () => {
    const { file, db } = await created()
    const rotated = await rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: OTHER, confirm: OTHER } } })
    const hidden = rotated.recoveryKey.toString('ascii')
    rotated.recoveryKey.fill(0)
    db.raw.close()
    const opened = await unlockWithPassword(file, ADMIN_A)
    expect(normalUseAllowed(opened)).toBe(false)
    expect(() => acknowledgeRecoveryKeyShown(opened)).toThrow(KeyError)
    const shown = await regenerateRecoveryKey(opened)
    expect(normalUseAllowed(opened)).toBe(false)
    acknowledgeRecoveryKeyShown(opened)
    expect(normalUseAllowed(opened)).toBe(true)
    opened.raw.close()
    await expect(unlockWithRecovery(file, hidden)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const recovered = await unlockWithRecovery(file, shown.toString('ascii'))
    recovered.raw.close()
    shown.fill(0)
  })
})
