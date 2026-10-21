// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { packErtx, unpackErtx, type ErtxManifest } from '@ert/sync'
import { createApp } from './app.js'
import { Clock, RaceService } from './service.js'

async function fixture() {
  const db = await openDatabase(':memory:')
  const clock = new Clock()
  const service = new RaceService(db, clock)
  service.importEvent({
    id: 'EV',
    name: 'Original',
    date: '2027-06-12',
    timezone: 'Europe/Helsinki',
    sport: 'run',
    races: [],
    categories: [],
  })
  service.setPin('1234')
  const backups: string[] = []
  const { app } = await createApp({
    db,
    testMode: true,
    backup: async (reason) => {
      const name = db.get<{ name: string }>('SELECT name FROM event')?.name
      backups.push(`${reason}:${name}`)
    },
  })
  const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: { pin: '1234' } })
  const auth = { authorization: `Bearer ${session.json().token as string}` }
  return { db, service, app, auth, backups }
}

async function archive(service: RaceService, mutate?: (data: Record<string, Record<string, unknown>[]>, manifest: ErtxManifest) => void) {
  const unpacked = await unpackErtx(service.exportErtx())
  const data = unpacked.data as Record<string, Record<string, unknown>[]>
  mutate?.(data, unpacked.manifest)
  return Buffer.from(packErtx(data, unpacked.manifest)).toString('base64')
}

describe('.ertx import', () => {
  it('rejects an unauthenticated import without changing data', async () => {
    const { db, service, app } = await fixture()
    const base64 = await archive(service, (data) => { data.event[0].name = 'Stolen' })
    const response = await app.inject({ method: 'POST', url: '/api/v1/sync/import', payload: { base64, confirm: true } })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('PIN_REQUIRED')
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Original')
    db.raw.close()
    await app.close()
  })

  it('rejects a malicious column and a too-new schema before writing', async () => {
    const { db, service, app, auth, backups } = await fixture()
    const malicious = await archive(service, (data) => {
      data.event[0]['name); DROP TABLE event; --'] = 'x'
    })
    const column = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: auth,
      payload: { base64: malicious, confirm: true },
    })
    expect(column.statusCode).toBe(422)
    expect(column.json().error.message).toMatch(/Column event\./)
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Original')

    const future = await archive(service, (_data, manifest) => { manifest.schema_version = 99 })
    const schema = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: auth,
      payload: { base64: future, confirm: true },
    })
    expect(schema.statusCode).toBe(422)
    expect(schema.json().error.message).toMatch(/schema version 99/)
    expect(backups).toEqual([])
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Original')
    db.raw.close()
    await app.close()
  })

  it('previews without writing, then backs up before a confirmed replace', async () => {
    const { db, service, app, auth, backups } = await fixture()
    const base64 = await archive(service, (data) => { data.event[0].name = 'Imported' })
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: auth,
      payload: { base64 },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().preview).toBe(true)
    expect(preview.json().tables.event).toBe(1)
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Original')
    expect(backups).toEqual([])

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: auth,
      payload: { base64, confirm: true },
    })
    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({ ok: true })
    expect(backups).toEqual(['import:Original'])
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Imported')
    expect(service.audit().some((row) => row.action === 'import_ertx' && row.reason === 'ertx import')).toBe(true)
    expect(service.checkPin('1234')).toEqual({ ok: true })
    db.raw.close()
    await app.close()
  })

  it('keeps the database when the backup fails', async () => {
    const db = await openDatabase(':memory:')
    const service = new RaceService(db, new Clock())
    service.importEvent({ id: 'EV', name: 'Original', date: '2027-06-12', timezone: 'Europe/Helsinki', sport: 'run', races: [], categories: [] })
    const { app } = await createApp({
      db,
      testMode: true,
      backup: async () => { throw new Error('disk full') },
    })
    const session = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const base64 = await archive(service, (data) => { data.event[0].name = 'Imported' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: { authorization: `Bearer ${session.json().token as string}` },
      payload: { base64, confirm: true },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json().error.code).toBe('BACKUP_FAILED')
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Original')
    db.raw.close()
    await app.close()
  })

  it('rejects an unknown table and a missing app version', async () => {
    const { db, service, app, auth } = await fixture()
    const table = await archive(service, (data) => { data.evil = [{ id: '1' }] })
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: auth,
      payload: { base64: table, confirm: true },
    })
    expect(unknown.statusCode).toBe(422)
    expect(unknown.json().error.message).toMatch(/Table evil/)

    const version = await archive(service, (_data, manifest) => { manifest.app_version = '' })
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/import',
      headers: auth,
      payload: { base64: version },
    })
    expect(missing.statusCode).toBe(422)
    expect(missing.json().error.message).toMatch(/app_version/)
    expect(db.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Original')
    db.raw.close()
    await app.close()
  })
})
