// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProtectedRaceFile } from '@ert/storage'
import { createApp } from './app.js'

const ADMIN_A = 'correct-horse-battery'
const ADMIN_B = 'staple-river-margin'
const OTHER = 'other-admin-present-now'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function openApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-key-routes-'))
  dirs.push(dir)
  const file = path.join(dir, 'ert.sqlite')
  const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
  created.recoveryKey.fill(0)
  const { app } = await createApp({ db: created.db, testMode: true, runtime: { url: '', dataDir: dir, dbPath: file } })
  return { app, db: created.db }
}

describe('key routes', () => {
  it('rejects a password change until the new recovery key is acknowledged', async () => {
    const { app, db } = await openApp()
    const status = await app.inject({ method: 'GET', url: '/api/v1/keys/status', headers: { host: 'localhost' } })
    expect(status.statusCode).toBe(200)
    expect(status.json()).toEqual({ state: 'admin' })
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
