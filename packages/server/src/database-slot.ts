// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import type { AppDb } from '@ert/storage'
import { keyFilePath } from '@ert/storage'

/** The live race database. Unlock replaces `current` so callers keep one reference. */
export interface DatabaseSlot {
  current: AppDb
  /** This process opened the memory stand-in because a key envelope was present. */
  startedLocked?: boolean
}

/** Forwards every read and write to whichever database is current. */
export function databaseProxy(slot: DatabaseSlot): AppDb {
  return new Proxy({} as AppDb, {
    get(_target, property) {
      const value = Reflect.get(slot.current, property, slot.current) as unknown
      return typeof value === 'function' ? value.bind(slot.current) : value
    },
    set(_target, property, value) {
      Reflect.set(slot.current, property, value, slot.current)
      return true
    },
  })
}

/** A version-1 key envelope is 320 bytes and starts with ERTK. The path is not returned. */
export function envelopeReady(filePath: string): boolean {
  let fd: number | undefined
  try {
    fd = fs.openSync(keyFilePath(filePath), 'r')
    const head = Buffer.alloc(4)
    const read = fs.readSync(fd, head, 0, 4, 0)
    return read === 4 && fs.fstatSync(fd).size === 320 && head.toString('ascii') === 'ERTK'
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
