// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KeyError, RaceFileError } from './errors.js'
import { setKeyLogger } from './key-log.js'
import { keyFilePath } from './key-file.js'
import { acknowledgeRecoveryKeyShown, recoveryHooks, regenerateRecoveryKey, rewrapAdminSlot } from './key-rewrap.js'
import { rotateDataKey } from './key-rotate.js'
import { createProtectedRaceFile, keyHooks, normalUseAllowed, unlockWithPassword, unlockWithRecovery } from './key-slots.js'
import { ensureKeyColumns } from './schema.js'

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
  keyHooks.integrityOk = undefined
  keyHooks.openFailure = undefined
  recoveryHooks.afterFlag = undefined
  recoveryHooks.afterEnvelope = undefined
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

const BELONGS = 'This key file does not belong to this race file, or the race file is damaged. Use the key file that was saved together with the race file, or restore a backup.'

function watchLogs(): string[] {
  const logs: string[] = []
  setKeyLogger((event, fields) => logs.push(JSON.stringify({ event, ...fields })))
  return logs
}

function expectBelongs(error: unknown, file: string, fileId: string): void {
  expect(error).toBeInstanceOf(KeyError)
  const keyError = error as KeyError
  expect(keyError.code).toBe('KEY_FILE_MISMATCH')
  expect(keyError.message).toBe(BELONGS)
  expect(keyError.message).not.toContain(file)
  expect(keyError.message).not.toContain(fileId)
  expect(JSON.stringify(keyError)).not.toContain(fileId)
}

function expectQuiet(logs: string[], hidden: string[]): void {
  const captured = logs.join('\n')
  for (const secret of hidden) expect(captured).not.toContain(secret)
}

async function rejected(file: string, secret: string): Promise<unknown> {
  return unlockWithPassword(file, secret).then(() => null, (error: unknown) => error)
}

describe('key file mismatch', () => {
  it('follows a correct password, counts the attempt, and names no secret', async () => {
    const { file, db } = await created()
    const fileId = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id ?? ''
    db.raw.close()
    const logs = watchLogs()
    expect(await rejected(file, 'not-the-admin-password')).toMatchObject({ code: 'UNLOCK_FAILED' })
    const matched = await unlockWithPassword(file, ADMIN_A)
    matched.run('UPDATE schema_meta SET key_generation = 2 WHERE id = 1')
    matched.raw.close()
    expectBelongs(await rejected(file, ADMIN_A), file, fileId)
    expect(logs).toContain(JSON.stringify({ event: 'unlock mismatch' }))
    expectQuiet(logs, [file, ADMIN_A, fileId, 'path', 'password', 'file_id'])
    const record = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
    expect(record.failureCount).toBe(1)
  })

  it('logs a field-less mismatch when the integrity check fails', async () => {
    const { file, db } = await created()
    const fileId = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id ?? ''
    db.raw.close()
    keyHooks.integrityOk = () => false
    const logs = watchLogs()
    const error = await rejected(file, ADMIN_A)
    expect(error).toMatchObject({ code: 'RACE_FILE_CORRUPT' })
    expect(JSON.stringify(error)).not.toContain('KEY_FILE_MISMATCH')
    expect(logs).toContain(JSON.stringify({ event: 'unlock mismatch' }))
    expectQuiet(logs, [file, ADMIN_A, fileId, 'path', 'password', 'file_id'])
    keyHooks.openFailure = new RaceFileError('ert.sqlite', 'open')
    const unread = watchLogs()
    const unreadable = await rejected(file, ADMIN_A)
    expect(unreadable).toMatchObject({ code: 'RACE_FILE_CORRUPT' })
    expect(unread).toContain(JSON.stringify({ event: 'unlock mismatch' }))
    expectQuiet(unread, [file, ADMIN_A, fileId, 'path', 'password', 'file_id'])
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
    const opened = await unlockWithRecovery(file, shown.recoveryKey.toString('ascii'))
    opened.raw.close()
    rotated.recoveryKey.fill(0)
    shown.recoveryKey.fill(0)
  })
})

describe('unshown recovery key', () => {
  it('rejects a password change until the new recovery key is acknowledged', async () => {
    const { db } = await created()
    const rotated = await rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'temporary', password: { password: OTHER, confirm: OTHER } } })
    rotated.recoveryKey.fill(0)
    const next = { password: 'replacement-admin-password', confirm: 'replacement-admin-password' }
    await expect(rewrapAdminSlot(db, 0, next, ADMIN_A)).rejects.toMatchObject({ code: 'RECOVERY_UNACKNOWLEDGED' })
    db.raw.close()
  })

  it('requires a new recovery key when rotation died before the key was shown', async () => {
    const { file, db } = await created()
    const rotated = await rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: OTHER, confirm: OTHER } } })
    const hidden = rotated.recoveryKey.toString('ascii')
    rotated.recoveryKey.fill(0)
    db.raw.close()
    const opened = await unlockWithPassword(file, ADMIN_A)
    expect(normalUseAllowed(opened)).toBe(false)
    await expect(acknowledgeRecoveryKeyShown(opened, rotated.generation)).rejects.toThrow(KeyError)
    const shown = await regenerateRecoveryKey(opened)
    expect(normalUseAllowed(opened)).toBe(false)
    await acknowledgeRecoveryKeyShown(opened, shown.generation)
    expect(normalUseAllowed(opened)).toBe(true)
    opened.raw.close()
    await expect(unlockWithRecovery(file, hidden)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const recovered = await unlockWithRecovery(file, shown.recoveryKey.toString('ascii'))
    recovered.raw.close()
    shown.recoveryKey.fill(0)
  })

  it('keeps use blocked when an older recovery key is acknowledged', async () => {
    const { db } = await created()
    const first = regenerateRecoveryKey(db)
    const second = regenerateRecoveryKey(db)
    const [older, newer] = await Promise.all([first, second])
    expect(older.generation).toBeLessThan(newer.generation)
    await expect(acknowledgeRecoveryKeyShown(db, older.generation)).rejects.toThrow(KeyError)
    expect(normalUseAllowed(db)).toBe(false)
    expect(ensureKeyColumns(db.raw).recoveryUnshown).toBe(true)
    expect(ensureKeyColumns(db.raw).recoveryGeneration).toBe(newer.generation)
    await acknowledgeRecoveryKeyShown(db, newer.generation)
    expect(normalUseAllowed(db)).toBe(true)
    older.recoveryKey.fill(0)
    newer.recoveryKey.fill(0)
    db.raw.close()
  })
})

async function stopped(hook: 'afterFlag' | 'afterEnvelope'): Promise<{ file: string; recovery: string; before: Buffer }> {
  const file = tempFile()
  const made = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
  const recovery = made.recoveryKey.toString('ascii')
  const before = fs.readFileSync(keyFilePath(file))
  recoveryHooks[hook] = () => {
    throw new Error('stop')
  }
  await expect(regenerateRecoveryKey(made.db)).rejects.toThrow(/stop/)
  made.db.raw.close()
  made.recoveryKey.fill(0)
  return { file, recovery, before }
}

async function expectUnshown(file: string): Promise<void> {
  const opened = await unlockWithPassword(file, ADMIN_A)
  expect(opened.keySession?.kind).toBe('recovery-unshown')
  expect(normalUseAllowed(opened)).toBe(false)
  opened.raw.close()
}

describe('recovery key crash points', () => {
  it('keeps the previous key and the warning when regeneration stops before the key file', async () => {
    const { file, recovery, before } = await stopped('afterFlag')
    expect(fs.readFileSync(keyFilePath(file)).equals(before)).toBe(true)
    await expectUnshown(file)
    const recovered = await unlockWithRecovery(file, recovery)
    expect(normalUseAllowed(recovered)).toBe(false)
    recovered.raw.close()
  })

  it('keeps the warning when regeneration stops after both writes', async () => {
    const { file, recovery, before } = await stopped('afterEnvelope')
    expect(fs.readFileSync(keyFilePath(file)).equals(before)).toBe(false)
    await expectUnshown(file)
    await expect(unlockWithRecovery(file, recovery)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
  })
})

describe('old key file beside a new database', () => {
  it('reports a mismatch after the slot opens and still counts the attempt', async () => {
    const file = tempFile()
    const first = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    const oldKey = fs.readFileSync(keyFilePath(file))
    const oldRecovery = first.recoveryKey.toString('ascii')
    const fileId = first.db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id ?? ''
    first.db.raw.close()
    first.recoveryKey.fill(0)
    const next = tempFile()
    const made = await createProtectedRaceFile(next, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    made.db.raw.close()
    made.recoveryKey.fill(0)
    fs.writeFileSync(keyFilePath(next), oldKey)
    const logs = watchLogs()
    expect(await rejected(next, 'not-the-admin-password')).toMatchObject({ code: 'UNLOCK_FAILED' })
    expectBelongs(await rejected(next, ADMIN_A), next, fileId)
    const recovered = await unlockWithRecovery(next, oldRecovery).then(() => null, (error: unknown) => error)
    expect(recovered).toMatchObject({ code: 'KEY_FILE_MISMATCH' })
    expectQuiet(logs, [next, ADMIN_A, oldRecovery, fileId])
    const record = JSON.parse(fs.readFileSync(path.join(path.dirname(next), 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
    expect(record.failureCount).toBe(3)
  })
})
