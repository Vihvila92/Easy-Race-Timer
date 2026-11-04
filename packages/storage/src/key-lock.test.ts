// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { kdfHooks } from './key-kdf.js'
import { ADMIN_A, ADMIN_B, installSlotHooks, tempDir } from './key-slots-fixture.js'
import { regenerateRecoveryKey, rewrapAdminSlot } from './key-rewrap.js'
import { createProtectedRaceFile, unlockWithPassword } from './key-slots.js'

installSlotHooks()

describe('key file lock', () => {
  it('runs a rewrap and a recovery regeneration one at a time', async () => {
    const file = path.join(tempDir(), 'ert.sqlite')
    const created = await createProtectedRaceFile(file, { password: ADMIN_A, confirm: ADMIN_A }, { password: ADMIN_B, confirm: ADMIN_B })
    let inFlight = 0
    let overlapped = false
    kdfHooks.onDerive = () => {
      inFlight += 1
    }
    kdfHooks.onKek = () => {
      inFlight -= 1
    }
    kdfHooks.onHkdf = () => {
      if (inFlight > 0) overlapped = true
    }
    const shown = await Promise.all([
      rewrapAdminSlot(created.db, 0, { password: 'first-admin-replaced', confirm: 'first-admin-replaced' }, ADMIN_A),
      regenerateRecoveryKey(created.db),
    ])
    expect(overlapped).toBe(false)
    created.db.raw.close()
    shown[1].fill(0)
    const opened = await unlockWithPassword(file, 'first-admin-replaced')
    opened.raw.close()
  })
})
