// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { secureRemove } from './atomic.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('secureRemove', () => {
  it('unlinks a hard link without overwriting the other name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-unlink-'))
    dirs.push(dir)
    const original = path.join(dir, 'data')
    const extra = path.join(dir, 'extra')
    const body = 'canary-bytes-not-zeros'
    fs.writeFileSync(original, body)
    fs.linkSync(original, extra)
    secureRemove(extra)
    expect(fs.existsSync(extra)).toBe(false)
    expect(fs.readFileSync(original).toString()).toBe(body)
  })
})
