// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProtectedRaceFile, openDatabase } from '@ert/storage'
import { createApp } from './app.js'

const HOST = { host: 'localhost' }
const ADMIN_A = 'correct-horse-battery'
const ADMIN_B = 'staple-river-margin'
const OTHER = 'other-admin-present-now'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function protectedFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-key-routes-'))
  dirs.push(dir)
  const file = path.join(dir, 'ert.sqlite')
  const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
  return { dir, file, created }
}

async function openApp() {
  const { dir, file, created } = await protectedFile()
  created.recoveryKey.fill(0)
  const { app } = await createApp({ db: created.db, testMode: true, runtime: { url: '', dataDir: dir, dbPath: file } })
  return { app, db: created.db }
}

describe('key routes', () => {
  it('rejects a password change until the new recovery key is acknowledged', async () => {
    const { app, db } = await openApp()
    const status = await app.inject({ method: 'GET', url: '/api/v1/keys/status', headers: { host: 'localhost' } })
    expect(status.statusCode).toBe(200)
    expect(status.json()).toMatchObject({ state: 'admin', fileName: 'ert.sqlite' })
    const rotated = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/rotate',
      headers: { host: 'localhost' },
      payload: { actingPassword: ADMIN_A, other: 'temporary', password: OTHER, confirm: OTHER },
    })
    expect(rotated.statusCode).toBe(200)
    const body = rotated.json() as { recoveryKey?: string; generation?: number; temporary?: boolean }
    expect(body.temporary).toBe(true)
    expect(typeof body.recoveryKey).toBe('string')
    expect(body.recoveryKey).not.toContain(ADMIN_A)
    expect(rotated.headers['location']).toBeUndefined()
    const gated = await app.inject({ method: 'POST', url: '/api/v1/events/import', headers: HOST, payload: {} })
    expect(gated.statusCode).toBe(423)
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/password',
      headers: { host: 'localhost' },
      payload: { target: 'self', password: 'replacement-admin-password', confirm: 'replacement-admin-password', currentPassword: ADMIN_A },
    })
    expect(changed.statusCode).toBe(409)
    expect(changed.json().error.code).toBe('RECOVERY_UNACKNOWLEDGED')
    expect(JSON.stringify(changed.json())).not.toContain(ADMIN_A)
    db.raw.close()
    await app.close()
  })
})

describe('recovery gate', () => {
  it('sets an admin password after recovery and then opens the race routes', async () => {
    const { dir, file, created } = await protectedFile()
    const recoveryKey = created.recoveryKey.toString('ascii')
    created.recoveryKey.fill(0)
    created.db.raw.close()
    const slot = { current: await openDatabase(':memory:') }
    const { app } = await createApp({ db: slot.current, slot, testMode: true, runtime: { url: '', dataDir: dir, dbPath: file } })
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/events/import', headers: HOST, payload: {} })
    expect(blocked.statusCode).toBe(423)
    expect(blocked.json().error.code).toBe('KEY_GATE')
    const recovered = await app.inject({ method: 'POST', url: '/api/v1/keys/recover', headers: HOST, payload: { recoveryKey } })
    expect(recovered.statusCode).toBe(200)
    expect(recovered.json()).toMatchObject({ state: 'recovery-gate', fileName: 'ert.sqlite' })
    const during = await app.inject({ method: 'POST', url: '/api/v1/events/import', headers: HOST, payload: {} })
    expect(during.statusCode).toBe(423)
    const next = 'replacement-admin-password'
    const saved = await app.inject({ method: 'POST', url: '/api/v1/keys/password', headers: HOST, payload: { slot: 0, password: next, confirm: next } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().state).toBe('admin')
    const openedRoute = await app.inject({ method: 'POST', url: '/api/v1/events/import', headers: HOST, payload: {} })
    expect(openedRoute.statusCode).not.toBe(423)
    const health = await app.inject({ method: 'GET', url: '/api/v1/health', headers: HOST })
    expect(health.statusCode).toBe(200)
    expect(String(saved.headers['cache-control'])).toContain('no-store')
    const opened = slot.current
    opened.keySession = null
    await app.inject({ method: 'POST', url: '/api/v1/keys/unlock', headers: HOST, payload: { password: next } })
    expect(() => opened.raw.prepare('select 1').get()).toThrow()
    slot.current.raw.close()
    await app.close()
  })
})

describe('acting password', () => {
  it('asks for the acting password and stays on this computer', async () => {
    const { app, db } = await openApp()
    const missing = await app.inject({ method: 'POST', url: '/api/v1/keys/recovery', headers: HOST, payload: {} })
    expect(missing.statusCode).toBe(422)
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/keys/recovery', headers: HOST, payload: { actingPassword: 'not-the-admin-password' } })
    expect(wrong.statusCode).toBe(401)
    const other = await app.inject({ method: 'POST', url: '/api/v1/keys/password', headers: HOST, payload: { target: 'other', password: OTHER, confirm: OTHER } })
    expect(other.statusCode).toBe(422)
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/password',
      headers: HOST,
      payload: { target: 'other', actingPassword: ADMIN_A, password: OTHER, confirm: OTHER },
    })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().singleAdmin).toBe(true)
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/keys/status', remoteAddress: '8.8.8.8', headers: HOST })
    expect(anonymous.statusCode).toBe(401)
    expect(String(anonymous.headers['cache-control'])).toContain('no-store')
    const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', headers: HOST, payload: {} })
    const token = session.json().token as string
    const remote = await app.inject({
      method: 'GET',
      url: '/api/v1/keys/status',
      remoteAddress: '8.8.8.8',
      headers: { host: 'localhost', authorization: `Bearer ${token}` },
    })
    expect(remote.statusCode).toBe(403)
    const issued = await app.inject({ method: 'POST', url: '/api/v1/keys/recovery', headers: HOST, payload: { actingPassword: ADMIN_A } })
    expect(issued.statusCode).toBe(200)
    expect(String(issued.json().recoveryKey)).not.toContain(ADMIN_A)
    db.run('UPDATE schema_meta SET schema_version = 999 WHERE id = 1')
    db.keySession = null
    const newer = await app.inject({ method: 'POST', url: '/api/v1/keys/unlock', headers: HOST, payload: { password: ADMIN_A } })
    expect(newer.statusCode).toBe(409)
    expect(newer.json().error.code).toBe('RACE_FILE_NEWER')
    db.raw.close()
    await app.close()
  })
})
