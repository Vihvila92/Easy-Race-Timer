// SPDX-License-Identifier: AGPL-3.0-only
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ERTX_MAX_UNCOMPRESSED_BYTES, ErtxError, packErtx, unpackErtx } from './index.js'

const manifest = { format_version: 1, app_version: '0.1.0', schema_version: 1 }

describe('unpackErtx', () => {
  it('reads a two-file archive', async () => {
    const unpacked = await unpackErtx(packErtx({ event: [] }, manifest))
    expect(unpacked.manifest).toEqual(manifest)
    expect(unpacked.data).toEqual({ event: [] })
  })

  it('rejects an unexpected file name', async () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'data.json': strToU8('{}'),
      'evil.sql': strToU8('DROP TABLE event'),
    })
    await expect(unpackErtx(bytes)).rejects.toBeInstanceOf(ErtxError)
    await expect(unpackErtx(bytes)).rejects.toThrow(/Unexpected file/)
  })

  it('rejects a zip bomb before inflating it', async () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'data.json': new Uint8Array(ERTX_MAX_UNCOMPRESSED_BYTES + 1),
    })
    await expect(unpackErtx(bytes)).rejects.toThrow(/exceeds the/)
  })
})
