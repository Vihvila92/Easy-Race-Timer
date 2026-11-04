// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { redactCrash } from './key-log.js'

describe('crash redaction', () => {
  it('replaces a buffer stored under a name that is not on the secret list', () => {
    const canary = Buffer.from('canary-bytes-not-for-logs')
    const dumped = redactCrash({ mystery: canary, secret: canary, nested: { payload: new Uint8Array(canary) } })
    expect(dumped).not.toContain('canary-bytes-not-for-logs')
    expect(dumped).toContain('[Buffer]')
    expect(dumped).toContain('[Redacted]')
    canary.fill(0)
  })
})
