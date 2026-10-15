import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ERTX_MAX_UNCOMPRESSED_BYTES } from '@ert/sync'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'

describe('.ertx zip bomb', () => {
  it('rejects the archive with a clear error and keeps serving', async () => {
    const db = await openDatabase(':memory:')
    const { app } = createApp({ db, testMode: true })
    const bytes = zipSync({
      'manifest.json': strToU8('{"format_version":1,"app_version":"0.1.0","schema_version":1}'),
      'data.json': new Uint8Array(ERTX_MAX_UNCOMPRESSED_BYTES + 1),
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      payload: { base64: Buffer.from(bytes).toString('base64') },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    })
    expect(response.json().error.message).toMatch(/exceeds the/)
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(health.statusCode).toBe(200)
    db.raw.close()
    await app.close()
  })
})