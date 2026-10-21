// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SQLITE_PLAINTEXT_HEADER } from '@ert/storage'
import { describe, expect, it } from 'vitest'
import { desktopKeyPath, openRaceDatabase } from './database.js'

describe('race database', () => {
  it('opens memory without a key and refuses an environment key in production', async () => {
    const db = await openRaceDatabase(':memory:', { production: true, env: {} })
    expect(db.get('SELECT 1 AS ok')).toEqual({ ok: 1 })
    db.raw.close()
    const dev = await openRaceDatabase(':memory:', { production: false, env: { ERT_DEV_KEY: '1', NODE_ENV: 'test' } })
    dev.raw.close()
    await expect(openRaceDatabase(':memory:', { production: true, env: { ERT_DB_KEY: 'secret' } })).rejects.toThrow(/environment/)
    await expect(openRaceDatabase(':memory:', { production: true, env: { ERT_DEV_DB_KEY: 'dev' } })).rejects.toThrow(/environment/)
    await expect(openRaceDatabase(':memory:', { production: true, env: { ERT_DEV_KEY: '1' } })).rejects.toThrow(/environment/)
  })

  it('opens an encrypted race file from the desktop key and reopens it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-desktop-key-'))
    const file = path.join(dir, 'ert.sqlite')
    const env = { NODE_ENV: 'production' }
    const first = await openRaceDatabase(file, { production: true, desktop: true, env })
    first.raw.close()
    const header = Buffer.alloc(SQLITE_PLAINTEXT_HEADER.length)
    const fd = fs.openSync(file, 'r')
    try {
      fs.readSync(fd, header, 0, header.length, 0)
    } finally {
      fs.closeSync(fd)
    }
    expect(header.equals(SQLITE_PLAINTEXT_HEADER)).toBe(false)
    expect(fs.statSync(desktopKeyPath(file)).size).toBe(32)
    const second = await openRaceDatabase(file, { production: true, desktop: true, env })
    expect(second.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')?.schema_version).toBeGreaterThan(0)
    second.raw.close()
    fs.rmSync(desktopKeyPath(file))
    await expect(openRaceDatabase(file, { production: true, desktop: true, env })).rejects.toThrow(/without a desktop data key/)
  })
})
