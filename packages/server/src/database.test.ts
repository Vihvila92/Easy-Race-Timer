import { describe, expect, it } from 'vitest'
import { openRaceDatabase } from './database.js'

describe('race database', () => {
  it('opens a keyless file and refuses a key from the environment in production', async () => {
    const db = await openRaceDatabase(':memory:', { production: true, env: {} })
    expect(db.get('SELECT 1 AS ok')).toEqual({ ok: 1 })
    db.raw.close()
    const dev = await openRaceDatabase(':memory:', { production: false, env: { ERT_DEV_DB_KEY: 'dev' } })
    dev.raw.close()
    await expect(openRaceDatabase(':memory:', { production: true, env: { ERT_DB_KEY: 'secret' } })).rejects.toThrow(/environment/)
    await expect(openRaceDatabase(':memory:', { production: true, env: { ERT_DEV_DB_KEY: 'dev' } })).rejects.toThrow(/environment/)
  })
})
