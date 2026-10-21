import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { holdExclusiveLock } from '@ert/storage'

describe('data directory lock', () => {
  it('lets the first server hold the lock and refuses a second one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-lock-'))
    const lockPath = path.join(dir, 'server.lock')
    const first = holdExclusiveLock(lockPath)
    expect(() => holdExclusiveLock(lockPath)).toThrow(/already running/)
    first.close()
    const second = holdExclusiveLock(lockPath)
    second.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
