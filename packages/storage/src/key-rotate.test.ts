// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setKeyLogger } from './key-log.js'
import { openDatabase, rekeyHooks } from './db.js'
import { KeyError } from './errors.js'
import { keyFilePath, rekeyTempPaths } from './key-file.js'
import { createProtectedRaceFile, keyHooks, normalUseAllowed, rewrapAdminSlot, unlockWithPassword, unlockWithRecovery } from './key-slots.js'
import { rotateDataKey } from './key-rotate.js'
import { devDataKey } from './key.js'

const ADMIN_A = 'correct-horse-battery'
const ADMIN_B = 'staple-river-margin'
const TEMP = 'temporary-admin-password'
const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-rotate-'))
  dirs.push(dir)
  return dir
}

function clonePair(file: string): string {
  const dir = tempDir()
  const dest = path.join(dir, 'ert.sqlite')
  fs.copyFileSync(file, dest)
  fs.copyFileSync(keyFilePath(file), keyFilePath(dest))
  return dest
}

async function createdFile(): Promise<{ file: string; recovery: string; db: Awaited<ReturnType<typeof createProtectedRaceFile>>['db'] }> {
  const file = path.join(tempDir(), 'ert.sqlite')
  const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
  created.db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
    VALUES ('p1', 'Aino', 'Testi', 'F', 2014, 'full', 1, 1, '1')`)
  created.db.raw.pragma('wal_checkpoint(TRUNCATE)')
  return { file, recovery: created.recoveryKey.toString('ascii'), db: created.db }
}

beforeEach(() => {
  setKeyLogger(() => undefined)
})

afterEach(() => {
  rekeyHooks.onPhase = undefined
  rekeyHooks.beforeRename = undefined
  rekeyHooks.afterDatabaseRename = undefined
  keyHooks.beforeAttach = undefined
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('data key rotation', () => {
  it('rekeys a copy, keeps the rows readable, and retires the old recovery key', async () => {
    const { file, recovery, db } = await createdFile()
    const preserved = clonePair(file)
    const phases: string[] = []
    rekeyHooks.onPhase = (phase, info) => {
      phases.push(phase)
      if (phase === 'journal-delete') expect(info.journal).toBe('delete')
      if (phase === 'journal-wal') expect(info.journal).toBe('wal')
      if (phase === 'rekey' || phase === 'checkpoint-after-rekey' || phase === 'journal-delete') {
        expect(info.file.endsWith('.rekey')).toBe(true)
        expect(info.file).not.toBe(file)
      }
    }
    const rotated = await rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'temporary', password: { password: TEMP, confirm: TEMP } } })
    expect(phases).toEqual([
      'checkpoint-before-copy',
      'journal-delete',
      'before-rekey',
      'rekey',
      'integrity-ok',
      'journal-wal',
      'checkpoint-after-rekey',
    ])
    expect(db.get<{ key_generation: number }>('SELECT key_generation FROM schema_meta WHERE id = 1')?.key_generation).toBe(2)
    expect(fs.readFileSync(keyFilePath(file)).readUInt32BE(26)).toBe(2)
    expect(db.get<{ reason: string }>("SELECT reason FROM key_audit WHERE action = 'dek_rotation'")?.reason).toBe('temporary_password')
    expect(db.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    const shown = Buffer.from(rotated.recoveryKey)
    const dek = Buffer.from(db.dataKey!)
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    const directory = path.dirname(file)
    const hex = dek.toString('hex')
    const files = fs.readdirSync(directory).map((name) => fs.readFileSync(path.join(directory, name)))
    expect(files.some((bytes) => bytes.includes(dek) || bytes.includes(Buffer.from(hex)) || bytes.includes(shown))).toBe(false)
    db.raw.close()
    const acting = await unlockWithPassword(file, ADMIN_A)
    expect(acting.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    expect(normalUseAllowed(acting)).toBe(true)
    acting.raw.close()
    const temporary = await unlockWithPassword(file, TEMP)
    expect(normalUseAllowed(temporary)).toBe(false)
    await rewrapAdminSlot(temporary, 1, { password: 'replaced-temporary-password', confirm: 'replaced-temporary-password' }, TEMP)
    expect(normalUseAllowed(temporary)).toBe(true)
    temporary.raw.close()
    await expect(unlockWithRecovery(file, recovery)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    const recovered = await unlockWithRecovery(file, shown.toString('ascii'))
    expect(normalUseAllowed(recovered)).toBe(false)
    recovered.raw.close()
    const old = await unlockWithPassword(preserved, ADMIN_B)
    expect(old.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    old.raw.close()
    shown.fill(0)
    dek.fill(0)
  })

  it('records the other admin when they set a password during rotation', async () => {
    const { file, db } = await createdFile()
    await rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: 'other-admin-present-now', confirm: 'other-admin-present-now' } } })
    expect(db.get<{ reason: string }>("SELECT reason FROM key_audit WHERE action = 'dek_rotation'")?.reason).toBe('other_admin_present')
    db.raw.close()
    const other = await unlockWithPassword(file, 'other-admin-present-now')
    expect(normalUseAllowed(other)).toBe(true)
    expect(other.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    other.raw.close()
  })

  it('leaves the original pair usable when rekey of the copy is interrupted', async () => {
    const { file, db } = await createdFile()
    rekeyHooks.onPhase = (phase) => {
      if (phase === 'before-rekey') throw new Error('stop')
    }
    await expect(rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: 'other-admin-present-now', confirm: 'other-admin-present-now' } } })).rejects.toThrow(/Rekey failed/)
    expect(fs.readdirSync(path.dirname(file)).some((name) => name.includes('.rekey'))).toBe(false)
    expect(db.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    db.raw.close()
    const opened = await unlockWithPassword(file, ADMIN_A)
    expect(opened.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    expect(fs.readFileSync(keyFilePath(file)).readUInt32BE(26)).toBe(1)
    opened.raw.close()
  })

  it('attaches the new key file when rotation stops after the database rename', async () => {
    const { file, db } = await createdFile()
    rekeyHooks.afterDatabaseRename = () => {
      throw new Error('stop')
    }
    await expect(rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'temporary', password: { password: TEMP, confirm: TEMP } } })).rejects.toThrow(/Rekey failed/)
    expect(fs.existsSync(rekeyTempPaths(file).key)).toBe(true)
    db.raw.close()
    const opened = await unlockWithPassword(file, ADMIN_A)
    expect(opened.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    expect(opened.get<{ key_generation: number }>('SELECT key_generation FROM schema_meta WHERE id = 1')?.key_generation).toBe(2)
    expect(fs.readFileSync(keyFilePath(file)).readUInt32BE(26)).toBe(2)
    expect(fs.existsSync(rekeyTempPaths(file).key)).toBe(false)
    opened.raw.close()
  })

  it('does not attach an old key file to the rekeyed database', async () => {
    const { file, db } = await createdFile()
    const oldKey = fs.readFileSync(keyFilePath(file))
    await rotateDataKey(db, { actingPassword: ADMIN_A, other: { kind: 'password', password: { password: 'other-admin-present-now', confirm: 'other-admin-present-now' } } })
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    db.raw.close()
    fs.writeFileSync(keyFilePath(file), oldKey)
    let attached = false
    keyHooks.beforeAttach = () => {
      attached = true
    }
    const error = await unlockWithPassword(file, ADMIN_A).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(KeyError)
    expect((error as KeyError).code).toBe('UNLOCK_FAILED')
    expect(attached).toBe(false)
  })
})

describe('page IV', () => {
  it('stores a new reserve IV when the same page is written again', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Aino', 'Testi', 'F', 2014, 'full', 1, 1, '1')`)
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    const first = pageIvs(file)
    db.run(`UPDATE person SET birth_year = 2015 WHERE id = 'p1'`)
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    const second = pageIvs(file)
    expect(first.length).toBe(second.length)
    expect(first.some((iv, index) => !iv.equals(second[index]!))).toBe(true)
    db.raw.close()
    const tampered = path.join(dir, 'tampered.sqlite')
    const bytes = fs.readFileSync(file)
    const page = 4096
    bytes[page - 80] ^= 0xff
    fs.writeFileSync(tampered, bytes)
    fs.copyFileSync(keyFilePath(file), keyFilePath(tampered))
    await expect(openDatabase(tampered, { dataKey: devDataKey() })).rejects.toThrow()
  })
})

function pageIvs(file: string): Buffer[] {
  const bytes = fs.readFileSync(file)
  const page = 4096
  const ivs: Buffer[] = []
  for (let offset = 0; offset + page <= bytes.length; offset += page) {
    ivs.push(Buffer.from(bytes.subarray(offset + page - 80, offset + page - 64)))
  }
  return ivs
}
