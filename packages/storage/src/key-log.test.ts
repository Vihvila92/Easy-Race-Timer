// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { redactCrash } from './key-log.js'

describe('crash redaction', () => {
  it('replaces a buffer stored under a name that is not on the secret list', () => {
    const canary = Buffer.from('canary-bytes-not-for-logs')
    const dumped = redactCrash({ mystery: canary, secret: canary, nested: { payload: new Uint8Array(canary) } })
    expect(dumped).not.toContain('canary-bytes-not-for-logs')
    expect(dumped).toContain('[Binary]')
    expect(dumped).toContain('[Redacted]')
    canary.fill(0)
  })

  it('replaces other typed arrays and array buffers', () => {
    const words = new Uint16Array([0xbeef, 0x4242])
    const raw = new ArrayBuffer(4)
    new DataView(raw).setUint32(0, 0x0badf00d)
    const dumped = redactCrash({ words, raw, nested: { view: new DataView(raw) } })
    expect(dumped).toContain('[Binary]')
    expect(dumped).not.toContain('48879')
    expect(dumped).not.toContain('16942')
    expect(dumped).not.toContain('195948557')
  })
})
