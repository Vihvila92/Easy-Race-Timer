import http from 'node:http'
import { Writable } from 'node:stream'
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { desktopHostAllowed, desktopOriginAllowed } from './guard.js'
import {
  AUTH_CODE_TTL_MS,
  LaunchCodes,
  isLaunchToken,
  launchCredentialMatches,
  readLaunchHandshake,
  redactRequestUrl,
  tokensEqual,
} from './launch-auth.js'

const token = 'ab'.repeat(32)
const code = 'cd'.repeat(32)

function desktopHeaders(extra: Record<string, string> = {}) {
  return { host: '127.0.0.1:80', cookie: `ert_launch=${token}`, origin: 'http://127.0.0.1:80', ...extra }
}

describe('launch token', () => {
  it('compares equal-length tokens without accepting a different length or a PIN bearer', () => {
    expect(isLaunchToken(token)).toBe(true)
    expect(isLaunchToken(token.toUpperCase())).toBe(false)
    expect(tokensEqual(token, token)).toBe(true)
    expect(tokensEqual(token, 'cd'.repeat(32))).toBe(false)
    expect(tokensEqual(token, 'abc')).toBe(false)
    expect(launchCredentialMatches(token, { authorization: `Bearer ${token}` })).toBe(true)
    expect(launchCredentialMatches(token, { cookie: `ert_session=nope; ert_launch=${token}` })).toBe(true)
    expect(launchCredentialMatches(token, { authorization: 'Bearer body.sig', cookie: `ert_launch=${token}` })).toBe(true)
    expect(launchCredentialMatches(token, {})).toBe(false)
  })

  it('reads one stdin line and treats a TTY or an immediate EOF as developer mode', async () => {
    const tty = new PassThrough() as PassThrough & { isTTY?: boolean }
    tty.isTTY = true
    await expect(readLaunchHandshake(tty as unknown as NodeJS.ReadStream)).resolves.toBeNull()

    const empty = new PassThrough()
    const pending = readLaunchHandshake(empty as unknown as NodeJS.ReadStream)
    empty.end()
    await expect(pending).resolves.toBeNull()

    const piped = new PassThrough()
    const line = readLaunchHandshake(piped as unknown as NodeJS.ReadStream)
    piped.write(`${token}\n`)
    await expect(line).resolves.toBe(token)

    const invalid = new PassThrough()
    const rejected = readLaunchHandshake(invalid as unknown as NodeJS.ReadStream)
    invalid.write('not-a-token\n')
    await expect(rejected).rejects.toThrow(/Invalid launch token/)
  })

  it('exchanges a one-time code for an HttpOnly cookie and requires it on the API', async () => {
    expect(desktopHostAllowed('127.0.0.1:80', null)).toBe(true)
    expect(desktopHostAllowed('localhost:80', null)).toBe(false)
    expect(desktopOriginAllowed('http://127.0.0.1:80', null)).toBe(true)
    expect(desktopOriginAllowed('http://localhost:80', null)).toBe(false)
    expect(redactRequestUrl(`/auth?code=${code}`)).toBe('/auth')

    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk))
        callback()
      },
    })
    const log = pino({
      serializers: {
        req(request: { method: string; url: string }) {
          return { method: request.method, url: redactRequestUrl(request.url) }
        },
      },
    }, stream)
    log.info({ req: { method: 'GET', url: `/auth?code=${code}` } }, 'incoming request')
    expect(lines.join('')).toContain('/auth')
    expect(lines.join('')).not.toContain(code)

    const db = await openDatabase(':memory:')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-launch-'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<p data-testid="wizard">wizard</p>')
    const codes = new LaunchCodes(code)
    const { app } = await createApp({
      db,
      testMode: true,
      webDist: dir,
      launch: { token, codes },
    })

    const page = await app.inject({ method: 'GET', url: '/', headers: { host: '127.0.0.1:80' } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('wizard')

    const hidden = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: '127.0.0.1:80' } })
    expect(hidden.statusCode).toBe(401)
    expect(hidden.json().error.code).toBe('VALIDATION_ERROR')

    const local = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: 'localhost:80', cookie: `ert_launch=${token}` } })
    expect(local.statusCode).toBe(421)

    const posted = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/pin/check',
      headers: { host: '127.0.0.1:80', cookie: `ert_launch=${token}`, 'content-type': 'application/json' },
      payload: {},
    })
    expect(posted.statusCode).toBe(403)

    const open = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: desktopHeaders(),
    })
    expect(open.statusCode).toBe(200)

    const bearer = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { host: '127.0.0.1:80', authorization: `Bearer ${token}` },
    })
    expect(bearer.statusCode).toBe(200)

    const first = await app.inject({ method: 'GET', url: `/auth?code=${code}`, headers: { host: '127.0.0.1:80' } })
    expect(first.statusCode).toBe(302)
    expect(first.headers.location).toBe('/')
    const cookie = String(first.headers['set-cookie'])
    expect(cookie).toContain(`ert_launch=${token}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')
    expect(cookie).not.toMatch(/max-age/i)
    expect(cookie).not.toMatch(/expires/i)
    expect(cookie).not.toContain(code)
    expect(String(first.headers['cache-control'])).toMatch(/no-store/i)
    expect(first.body).not.toContain(code)

    const second = await app.inject({ method: 'GET', url: `/auth?code=${code}`, headers: { host: '127.0.0.1:80' } })
    expect(second.statusCode).toBe(404)
    expect(second.body).not.toContain(code)
    expect(String(second.headers['cache-control'])).toMatch(/no-store/i)

    const expired = new LaunchCodes('ef'.repeat(32), Date.now() - AUTH_CODE_TTL_MS - 1)
    const { app: stale } = await createApp({
      db: await openDatabase(':memory:'),
      testMode: true,
      launch: { token, codes: expired },
    })
    const late = await stale.inject({ method: 'GET', url: `/auth?code=${'ef'.repeat(32)}`, headers: { host: '127.0.0.1:80' } })
    expect(late.statusCode).toBe(404)
    expect(late.body).not.toContain('ef'.repeat(32))

    const socket = await app.inject({
      method: 'GET',
      url: '/ws',
      headers: { host: '127.0.0.1:80', origin: 'http://127.0.0.1:80', upgrade: 'websocket', connection: 'Upgrade' },
    })
    expect(socket.statusCode).toBe(401)

    db.raw.close()
    await app.close()
    await stale.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unauthenticated websocket with 401 before the upgrade', async () => {
    const db = await openDatabase(':memory:')
    const codes = new LaunchCodes(code)
    const { app } = await createApp({
      db,
      testMode: true,
      launch: { token, codes },
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('sidecar test server has no port')
    const port = address.port
    const headers = {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': Buffer.from('easy-race-timer!').toString('base64'),
      'sec-websocket-version': '13',
    }

    const refused = await new Promise<number>((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path: '/ws', headers, agent: false }, (response) => {
        response.resume()
        response.socket?.destroy()
        resolve(response.statusCode ?? 0)
      })
      request.on('upgrade', (response) => {
        response.socket.destroy()
        reject(new Error(`unauthenticated /ws upgraded with ${response.statusCode}`))
      })
      request.setTimeout(5_000, () => {
        request.destroy()
        reject(new Error('unauthenticated /ws timed out'))
      })
      request.on('error', reject)
      request.end()
    })
    expect(refused).toBe(401)
    expect(refused).not.toBe(101)

    db.raw.close()
    // The upgrade listener keeps the server open after a raw socket 401.
    app.server.closeAllConnections()
    app.server.unref()
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
  })
})
