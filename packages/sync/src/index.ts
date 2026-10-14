import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export const ERTX_FORMAT_VERSION = 1

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

export function unpackErtx(bytes: Uint8Array): { manifest: ErtxManifest; data: unknown } {
  const files = unzipSync(bytes)
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as ErtxManifest
  if (manifest.format_version !== ERTX_FORMAT_VERSION) {
    throw new Error(`Unsupported .ertx format ${manifest.format_version}`)
  }
  return { manifest, data: JSON.parse(strFromU8(files['data.json'])) }
}
