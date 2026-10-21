// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'

/** True when `stat` is owned by `uid` and is not writable by group or others. */
export function directoryIsPrivate(stat: { uid: number; mode: number }, uid: number | undefined): boolean {
  if (uid === undefined) return true
  if (stat.uid !== uid) return false
  return (stat.mode & 0o022) === 0
}

/**
 * Refuse a directory we do not own, a link, or a directory that is still
 * writable by group or others. This check does not change the mode.
 */
export function assertDirectoryPrivate(dir: string): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return
  const stat = fs.lstatSync(dir)
  if (stat.isSymbolicLink()) throw new Error('Refusing a linked asset directory')
  if (!directoryIsPrivate(stat, process.getuid())) {
    throw new Error('Refusing an asset directory that is not private')
  }
}

/**
 * Create `dir` (mode 0700). If we own it and it is group-writable, tighten it
 * to 0700 and check again. Refuse another user's directory.
 */
export function ensurePrivateDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return
  const uid = process.getuid()
  let stat = fs.lstatSync(dir)
  if (stat.isSymbolicLink()) throw new Error('Refusing a linked asset directory')
  if (stat.uid !== uid) throw new Error('Refusing an asset directory owned by another user')
  if ((stat.mode & 0o022) !== 0) {
    fs.chmodSync(dir, 0o700)
    stat = fs.lstatSync(dir)
  }
  if (!directoryIsPrivate(stat, uid)) {
    throw new Error('Refusing an asset directory that is not private')
  }
}
