// SPDX-License-Identifier: AGPL-3.0-only
import { strFromU8, strToU8, unzip, zipSync } from 'fflate'

export const ERTX_FORMAT_VERSION = 1
export const ERTX_MAX_FILES = 2
export const ERTX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024

const ALLOWED_FILES = new Set(['manifest.json', 'data.json'])

export class ErtxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErtxError'
  }
}

export interface ErtxManifest {
  format_version: number
  app_version: string
  schema_version: number
}

/** File transport: a zip with manifest.json and data.json. */
export function packErtx(data: unknown, manifest: ErtxManifest): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'data.json': strToU8(JSON.stringify(data)),
  })
}

/**
 * Read an .ertx archive. Only manifest.json and data.json are inflated, and only
 * when their declared uncompressed size stays within the limit. A zip bomb is
 * rejected before decompression.
 */
export function unpackErtx(bytes: Uint8Array): Promise<{ manifest: ErtxManifest; data: unknown }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof ErtxError ? error : new ErtxError(error instanceof Error ? error.message : 'Could not read archive'))
    }
    let count = 0
    let total = 0
    try {
      unzip(bytes, {
        filter(file) {
          count += 1
          if (!ALLOWED_FILES.has(file.name)) {
            throw new ErtxError(`Unexpected file in archive: ${file.name}`)
          }
          if (count > ERTX_MAX_FILES) throw new ErtxError('Archive contains too many files')
          if (!Number.isFinite(file.originalSize) || file.originalSize < 0 || file.originalSize > ERTX_MAX_UNCOMPRESSED_BYTES) {
            throw new ErtxError(`Uncompressed size of ${file.name} exceeds the ${ERTX_MAX_UNCOMPRESSED_BYTES} byte limit`)
          }
          total += file.originalSize
          if (total > ERTX_MAX_UNCOMPRESSED_BYTES) {
            throw new ErtxError(`Uncompressed archive exceeds the ${ERTX_MAX_UNCOMPRESSED_BYTES} byte limit`)
          }
          return true
        },
      }, (error, files) => {
        if (settled) return
        if (error || !files?.['manifest.json'] || !files['data.json']) {
          fail(error ?? new ErtxError('Archive must contain manifest.json and data.json'))
          return
        }
        try {
          const manifest = JSON.parse(strFromU8(files['manifest.json'])) as ErtxManifest
          if (manifest.format_version !== ERTX_FORMAT_VERSION) {
            throw new ErtxError(`Unsupported .ertx format ${String(manifest.format_version)}`)
          }
          const data = JSON.parse(strFromU8(files['data.json'])) as unknown
          settled = true
          resolve({ manifest, data })
        } catch (parseError) {
          fail(parseError)
        }
      })
    } catch (error) {
      fail(error)
    }
  })
}
