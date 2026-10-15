import { scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { packErtx, unpackErtx } from '@ert/sync'
import * as serviceModule from './service.js'
import { Clock, RaceService } from './service.js'

async function serviceWithEvent() {
  const db = await openDatabase(':memory:')
  const service = new RaceService(db, new Clock())
  service.importEvent({
    id: 'EV',
    name: 'PIN',
    date: '2027-06-12',
    timezone: 'Europe/Helsinki',
    sport: 'run',
    races: [],
    categories: [],
  })
  return { db, service }
}

describe('PIN hash', () => {
  it('removes pinDigest and keeps pin_hash out of snapshot and .ertx', async () => {
    expect('pinDigest' in serviceModule).toBe(false)
    const { db, service } = await serviceWithEvent()
    service.setPin('1234')
    const stored = db.get<{ pin_hash: string }>('SELECT pin_hash FROM event')
    expect(stored?.pin_hash.startsWith('scrypt$131072$8$1$')).toBe(true)
    expect(JSON.stringify(db.snapshot())).not.toContain('pin_hash')
    expect(JSON.stringify(db.snapshot())).not.toContain(stored?.pin_hash)
    const exported = JSON.stringify((await unpackErtx(service.exportErtx())).data)
    expect(exported).not.toContain('pin_hash')
    expect(exported).not.toContain(stored?.pin_hash ?? 'missing')
    db.raw.close()
  })

  it('does not replace the local PIN on import', async () => {
    const { db, service } = await serviceWithEvent()
    service.setPin('1234')
    const before = db.get<{ pin_hash: string }>('SELECT pin_hash FROM event')?.pin_hash
    const unpacked = await unpackErtx(service.exportErtx())
    const data = unpacked.data as { event: Record<string, unknown>[] }
    data.event[0].pin_hash = 'stolen-hash'
    await expect(service.importErtx(packErtx(data, unpacked.manifest))).rejects.toThrow(/pin_hash/)
    const after = db.get<{ pin_hash: string }>('SELECT pin_hash FROM event')?.pin_hash
    expect(after).toBe(before)
    expect(after).not.toBe('stolen-hash')
    expect(service.checkPin('1234')).toEqual({ ok: true })
    db.raw.close()
  })

  it('upgrades a legacy scrypt hash on a successful check', async () => {
    const { db, service } = await serviceWithEvent()
    const salt = 'ab'.repeat(8)
    const legacy = scryptSync('1234', salt, 32).toString('hex')
    db.run('UPDATE event SET pin_hash = ? WHERE id = ?', `${salt}:${legacy}`, 'EV')
    expect(service.checkPin('1234')).toEqual({ ok: true })
    const stored = db.get<{ pin_hash: string }>('SELECT pin_hash FROM event')?.pin_hash ?? ''
    expect(stored.startsWith('scrypt$131072$8$1$')).toBe(true)
    expect(service.checkPin('1234')).toEqual({ ok: true })
    db.raw.close()
  })
})
