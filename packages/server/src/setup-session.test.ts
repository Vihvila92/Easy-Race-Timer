import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'

describe('setup session', () => {
  it('issues a token without a PIN only to loopback', async () => {
    const db = await openDatabase(':memory:')
    const { app } = createApp({ db, testMode: true })
    const remote = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/pin/check',
      payload: {},
      remoteAddress: '8.8.8.8',
    })
    expect(remote.statusCode).toBe(401)
    expect(remote.json().error.code).toBe('PIN_REQUIRED')
    expect(remote.headers['set-cookie']).toBeUndefined()

    const local = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    expect(local.statusCode).toBe(200)
    expect(local.json().token).toEqual(expect.any(String))

    const { service } = createApp({ db, testMode: true })
    service.importEvent({
      id: 'EV', name: 'PIN', date: '2027-06-12', timezone: 'Europe/Helsinki', sport: 'run', races: [], categories: [],
    })
    service.setPin('1234')
    const { app: locked } = createApp({ db, testMode: true })
    const denied = await locked.inject({
      method: 'POST',
      url: '/api/v1/settings/pin/check',
      payload: {},
      remoteAddress: '8.8.8.8',
    })
    expect(denied.statusCode).toBe(401)
    const opened = await locked.inject({
      method: 'POST',
      url: '/api/v1/settings/pin/check',
      payload: { pin: '1234' },
      remoteAddress: '8.8.8.8',
    })
    expect(opened.statusCode).toBe(200)
    db.raw.close()
    await app.close()
    await locked.close()
  })
})

describe('listen host', () => {
  it('refuses to start on a public address until a PIN exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-host-'))
    const dbFile = path.join(dir, 'ert.sqlite')
    const empty = await openDatabase(dbFile)
    empty.raw.close()
    const refused = await startHost('0.0.0.0', dbFile)
    expect(refused.code).not.toBe(0)
    expect(refused.output).toMatch(/PIN/)

    const ready = await openDatabase(dbFile)
    ready.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc, pin_hash)
      VALUES ('EV', 'local', 'Test', '2027-06-12', 'Europe/Helsinki', 'run', '{}', 1, 1, '1', 'set')`)
    ready.raw.close()
    const allowed = await startHost('0.0.0.0', dbFile)
    expect(allowed.code).toBe(0)
    expect(allowed.output).toMatch(/ERT_READY/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

function startHost(host: string, dbFile: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, HOST: host, PORT: '0', ERT_DB: dbFile, ERT_TEST_MODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, output })
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, 15_000)
    const keep = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('ERT_READY')) {
        child.kill('SIGTERM')
        finish(0)
      }
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('exit', (code) => finish(code))
  })
}
