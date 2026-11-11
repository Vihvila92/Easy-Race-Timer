// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { beginAttempt } from './key-backoff.js'
import { confirmActingPassword } from './key-rewrap.js'
import { rotateDataKey } from './key-rotate.js'
import { createProtectedRaceFile } from './key-slots.js'

const dirs: string[] = []
const firstAdmin = 'correct-horse-battery'
const secondAdmin = 'staple-river-margin'
const temporaryPassword = 'other-admin-present-now'

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function failures(file: string): number {
  const record = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'unlock-backoff.json'), 'utf8')) as { failureCount: number }
  return record.failureCount
}

describe('re-authentication backoff', () => {
  it('shares the unlock counter and clears it after the right password', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-reauth-'))
    dirs.push(dir)
    const file = path.join(dir, 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: firstAdmin, confirm: firstAdmin }, { password: secondAdmin, confirm: secondAdmin })
    created.recoveryKey.fill(0)
    const db = created.db
    for (let attempt = 0; attempt < 5; attempt += 1) beginAttempt(file)
    await expect(confirmActingPassword(db, 'not-the-admin-password')).rejects.toMatchObject({ code: 'UNLOCK_FAILED', retryAfterMs: expect.any(Number) })
    expect(failures(file)).toBe(5)
    fs.rmSync(path.join(dir, 'unlock-backoff.json'))
    await expect(confirmActingPassword(db, 'not-the-admin-password')).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    await expect(rotateDataKey(db, {
      actingPassword: 'not-the-admin-password',
      other: { kind: 'temporary', password: { password: temporaryPassword, confirm: temporaryPassword } },
    })).rejects.toMatchObject({ code: 'UNLOCK_FAILED' })
    expect(failures(file)).toBe(2)
    await confirmActingPassword(db, firstAdmin)
    expect(failures(file)).toBe(0)
    db.raw.close()
  })
})
