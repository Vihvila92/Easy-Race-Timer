// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AppDb } from '@ert/storage'
import { openDatabase } from '@ert/storage'

export interface RaceDatabaseOptions {
  production: boolean
  /**
   * Packaged sidecar. It keeps a raw 32-byte key beside the race file until
   * #131 wraps that key. The command-line server does not.
   */
  desktop?: boolean
  env: NodeJS.ProcessEnv
}

function environmentOffersKey(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.ERT_DB_KEY?.trim() || env.ERT_DEV_DB_KEY?.trim() || env.ERT_DEV_KEY === '1')
}

/** Local key for the desktop sidecar. Not the ERTS stub, and not a log field. */
export function desktopKeyPath(filePath: string): string {
  return path.join(path.dirname(filePath), 'desktop-data.key')
}

function loadOrCreateDesktopDataKey(filePath: string): Buffer {
  const keyPath = desktopKeyPath(filePath)
  if (fs.existsSync(keyPath)) {
    const key = fs.readFileSync(keyPath)
    if (key.length !== 32) throw new Error('The desktop data key file is unusable')
    return key
  }
  if (fs.existsSync(filePath)) {
    throw new Error('Refusing to open an existing race file without a desktop data key')
  }
  const key = randomBytes(32)
  fs.mkdirSync(path.dirname(keyPath), { recursive: true })
  const tmp = path.join(path.dirname(keyPath), `.desktop-data.key.${process.pid}.tmp`)
  fs.writeFileSync(tmp, key, { mode: 0o600 })
  try {
    fs.chmodSync(tmp, 0o600)
  } catch {
    // Some filesystems ignore the mode. The data directory is still per-user.
  }
  fs.renameSync(tmp, keyPath)
  return key
}

/**
 * Open the race file.
 *
 * Production refuses a key from the environment. The desktop sidecar creates
 * or reads `desktop-data.key` in-process. Every other production caller still
 * has to pass a data key through `openDatabase` and, with none, fails closed.
 */
export async function openRaceDatabase(filePath: string, options: RaceDatabaseOptions): Promise<AppDb> {
  if (options.production && environmentOffersKey(options.env)) {
    throw new Error('Refusing a database key from the environment')
  }
  if (options.desktop && options.production && filePath !== ':memory:') {
    const dataKey = loadOrCreateDesktopDataKey(filePath)
    try {
      return await openDatabase(filePath, { dataKey, env: options.env })
    } finally {
      dataKey.fill(0)
    }
  }
  return openDatabase(filePath, { env: options.env })
}
