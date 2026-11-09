// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { RaceFileError } from './errors.js'

/**
 * Companion of a race database. #131 replaces this stub with a 320-byte ERTK envelope.
 * This module does not wrap keys and does not write the data key.
 *
 * `ert.sqlite` pairs with `ert.keys`.
 * `club.sqlite` pairs with `club.keys`.
 * `ert.sqlite.v3.bak` pairs with `ert.sqlite.v3.keys`.
 * `ert-<stamp>-<reason>.sqlite` pairs with `ert-<stamp>-<reason>.keys`.
 */
export const KEY_STUB_MAGIC = Buffer.from('ERTS')
export const KEY_ENVELOPE_MAGIC = Buffer.from('ERTK')
/** magic 4, version uint16, reserved uint16, file_id 16. */
export const KEY_STUB_BYTES = 24
export const KEY_ENVELOPE_BYTES = 320

export function keyFilePath(databasePath: string): string {
  if (databasePath.endsWith('.sqlite')) return `${databasePath.slice(0, -'.sqlite'.length)}.keys`
  if (/\.v\d+\.bak$/.test(databasePath)) return databasePath.replace(/\.bak$/, '.keys')
  return `${databasePath}.keys`
}

/** Inverse of keyFilePath. A database path is returned unchanged. */
export function databasePathForKeyFile(keyPath: string): string {
  if (!keyPath.endsWith('.keys')) return keyPath
  const base = keyPath.slice(0, -'.keys'.length)
  if (/\.v\d+$/.test(base)) return `${base}.bak`
  return `${base}.sqlite`
}

/** A crashed temp-file write leaves `<prefix><pid>.<time>.tmp`. */
function numberedWriteTemp(name: string, prefix: string): boolean {
  if (!name.startsWith(prefix) || !name.endsWith('.tmp')) return false
  const parts = name.slice(prefix.length, -'.tmp'.length).split('.')
  return parts.length === 2 && parts.every((part) => part.length > 0 && [...part].every((char) => char >= '0' && char <= '9'))
}

/** Delete leftover key-file temps: `..ert.keys.rekey.*.tmp` and `.ert.keys.<pid>.<time>.tmp`. */
export function removeRekeyWriteTemps(databasePath: string): void {
  const directory = path.dirname(databasePath)
  if (!fs.existsSync(directory)) return
  const keyName = path.basename(keyFilePath(databasePath))
  for (const name of fs.readdirSync(directory)) {
    const stale = numberedWriteTemp(name, `..${keyName}.rekey.`) || numberedWriteTemp(name, `.${keyName}.`)
    if (!stale) continue
    secureRemove(path.join(directory, name))
  }
}

/** Temps for rekey-on-a-copy. `.ert.sqlite.rekey` and `.ert.keys.rekey` beside the live pair. */
export function rekeyTempPaths(databasePath: string): { database: string; key: string } {
  const directory = path.dirname(databasePath)
  return {
    database: path.join(directory, `.${path.basename(databasePath)}.rekey`),
    key: path.join(directory, `.${path.basename(keyFilePath(databasePath))}.rekey`),
  }
}

export type KeyFileKind = 'missing' | 'incomplete' | 'stub' | 'envelope'

export function encodeKeyStub(fileIdHex: string): Buffer {
  if (!/^[0-9a-f]{32}$/.test(fileIdHex)) throw new Error('file id must be 32 hex characters')
  const bytes = Buffer.alloc(KEY_STUB_BYTES)
  KEY_STUB_MAGIC.copy(bytes, 0)
  bytes.writeUInt16BE(0, 4)
  Buffer.from(fileIdHex, 'hex').copy(bytes, 8)
  return bytes
}

export function inspectKeyFile(keyPath: string): { kind: KeyFileKind; fileId: string | null } {
  if (!fs.existsSync(keyPath)) return { kind: 'missing', fileId: null }
  let data: Buffer
  try {
    data = fs.readFileSync(keyPath)
  } catch {
    return { kind: 'incomplete', fileId: null }
  }
  if (data.length >= 4 && data.subarray(0, 4).equals(KEY_ENVELOPE_MAGIC)) {
    if (data.length < KEY_ENVELOPE_BYTES) return { kind: 'incomplete', fileId: null }
    return { kind: 'envelope', fileId: data.subarray(8, 24).toString('hex') }
  }
  if (data.length >= KEY_STUB_BYTES && data.subarray(0, 4).equals(KEY_STUB_MAGIC) && data.readUInt16BE(4) === 0) {
    return { kind: 'stub', fileId: data.subarray(8, 24).toString('hex') }
  }
  return { kind: 'incomplete', fileId: null }
}

/** A backup pair is usable when the database exists and the key file is a whole stub or envelope. */
export function backupPairComplete(databasePath: string): boolean {
  if (!fs.existsSync(databasePath)) return false
  const info = inspectKeyFile(keyFilePath(databasePath))
  return info.kind === 'stub' || info.kind === 'envelope'
}

/** Temp file, fsync, rename, directory fsync, mode 0600. Shared by the stub, the envelope and the backoff file. */
export function writePrivateBytes(filePath: string, bytes: Buffer): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const tmp = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o600 })
    fsyncFile(tmp)
    fs.renameSync(tmp, filePath)
    fsyncDirectory(directory)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // Permissions are best-effort on filesystems that ignore them.
    }
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

export function writeKeyStub(keyPath: string, fileIdHex: string): void {
  writePrivateBytes(keyPath, encodeKeyStub(fileIdHex))
}

const keyWrites = new Map<string, Promise<void>>()

/** In-process only. One writer at a time for a key file in this process, including across awaits. Other processes are not locked. */
export function withKeyFileLock<T>(keyPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyWrites.get(keyPath) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  const settled = run.then(() => undefined, () => undefined)
  keyWrites.set(keyPath, settled)
  return run
}

/**
 * Create the stub when the companion is missing or truncated and is not an ERTK file.
 * Leave a matching stub or a complete ERTK envelope in place. #131 owns that format.
 * A file id that does not match is a hard failure and is not rewritten.
 * A short file whose magic is ERTK is a hard failure and is not rewritten.
 * Once #131 lands, a missing or invalid ERTK envelope must fail closed and must not be regenerated here.
 */
export function ensureKeyFile(databasePath: string, fileIdHex: string): void {
  const keyPath = keyFilePath(databasePath)
  const info = inspectKeyFile(keyPath)
  if (info.kind === 'stub' || info.kind === 'envelope') {
    if (info.fileId !== fileIdHex) throw new RaceFileError(path.basename(databasePath), 'key-file')
    return
  }
  if (info.kind === 'incomplete' && fs.existsSync(keyPath)) {
    const head = fs.readFileSync(keyPath).subarray(0, 4)
    if (head.equals(KEY_ENVELOPE_MAGIC)) throw new RaceFileError(path.basename(databasePath), 'key-file')
  }
  writeKeyStub(keyPath, fileIdHex)
}
