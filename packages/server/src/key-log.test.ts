// SPDX-License-Identifier: AGPL-3.0-only
import { Writable } from 'node:stream'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { redactCrash } from '@ert/storage'
import { productionLoggerOptions } from './app.js'

describe('key log redaction', () => {
  it('drops password, recovery key and data key fields from pino and the crash serializer', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString())
        callback()
      },
    })
    const log = pino(productionLoggerOptions(), stream)
    const canary = 'canary-horse-battery-staple'
    const printed = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC'
    log.info({ password: canary, nested: { recoveryKey: printed, dek: 'secret-dek' } }, 'unlock failed')
    await new Promise((resolve) => stream.write('', resolve))
    const output = lines.join('\n')
    expect(output).toContain('unlock failed')
    expect(output).not.toContain(canary)
    expect(output).not.toContain(printed)
    expect(output).not.toContain('secret-dek')
    expect(output).toContain('[Redacted]')
    const serialized = redactCrash(Object.assign(new Error('That did not open the file.'), { password: canary, recovery_key: printed }))
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain(printed)
    expect(serialized).toContain('That did not open the file.')
  })
})
