import http from 'node:http'
import crypto from 'node:crypto'
import type { Socket } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { issueToken, sessionSecret } from './session.js'

interface Handshake {
  status: number
  body: string
  frames: string[]
  waitFor: (count: number) => Promise<void>
  close: () => void
}

function endpoint(app: FastifyInstance): { port: number; host: string; origin: string } {
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('server is not listening')
  return { port: address.port, host: `127.0.0.1:${address.port}`, origin: `http://127.0.0.1:${address.port}` }
}

function connect(app: FastifyInstance, headers: Record<string, string | undefined>): Promise<Handshake> {
  const local = endpoint(app)
  const requestHeaders: Record<string, string> = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
    host: local.host,
    origin: local.origin,
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) delete requestHeaders[key]
    else requestHeaders[key] = value
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: local.port, path: '/ws?proto=1', headers: requestHeaders, agent: false })
    const fail = (error: Error) => {
      req.destroy()
      reject(error)
    }
    req.setTimeout(1000, () => fail(new Error('handshake timed out')))
    req.on('error', fail)
    req.on('upgrade', (res, socket, head) => resolve(liveSocket(res.statusCode ?? 101, socket, head)))
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        res.socket?.destroy()
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          frames: [],
          waitFor: async () => { throw new Error('connection was not upgraded') },
          close: () => undefined,
        })
      })
    })
    req.end()
  })
}

function liveSocket(status: number, socket: Socket, head: Buffer): Handshake {
  const frames: string[] = []
  let buffer = Buffer.from(head)
  let pending: { count: number; done: () => void } | null = null
  const take = () => {
    while (buffer.length >= 2) {
      const length = buffer[1] & 0x7f
      if (length >= 126) throw new Error('unexpected long websocket frame')
      if (buffer.length < 2 + length) return
      const opcode = buffer[0] & 0x0f
      if (opcode === 0x1) frames.push(buffer.subarray(2, 2 + length).toString('utf8'))
      buffer = buffer.subarray(2 + length)
      if (pending && frames.length >= pending.count) {
        const current = pending
        pending = null
        current.done()
      }
    }
  }
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    take()
  })
  take()
  return {
    status,
    body: '',
    frames,
    waitFor(count: number) {
      if (frames.length >= count) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out with ${frames.length} frames: ${frames.join(' | ')}`)), 1000)
        pending = {
          count,
          done: () => {
            clearTimeout(timer)
            resolve()
          },
        }
      })
    },
    close: () => socket.destroy(),
  }
}

describe('/ws handshake', () => {
  it('rejects a foreign origin, a missing token, and an invalid token', async () => {
    const db = await openDatabase(':memory:')
    const { app } = await createApp({ db, testMode: true })
    const opened: Handshake[] = []
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const local = endpoint(app)
      const issued = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/pin/check',
        headers: { host: local.host, 'content-type': 'application/json' },
        payload: {},
      })
      expect(issued.statusCode).toBe(200)
      const token = issued.json().token as string
      const forged = issueToken('not-the-server-secret')
      const expired = issueToken(sessionSecret(db), 0)

      const foreign = await connect(app, { origin: 'http://evil.example' })
      const foreignWithToken = await connect(app, { origin: 'http://evil.example', authorization: `Bearer ${token}` })
      const missingOrigin = await connect(app, { origin: undefined })
      const anonymous = await connect(app, {})
      const malformed = await connect(app, { authorization: 'Bearer nope' })
      const badSignature = await connect(app, { authorization: `Bearer ${forged}` })
      const stale = await connect(app, { authorization: `Bearer ${expired}` })
      const badCookie = await connect(app, { cookie: 'ert_session=nope' })
      const brokenCookie = await connect(app, { cookie: 'ert_session=%' })
      const truncatedCookie = await connect(app, { cookie: `ert_session=${token.slice(0, 12)}` })
      const partialEscape = await connect(app, { cookie: 'ert_session=%E0%A4' })
      opened.push(foreign, foreignWithToken, missingOrigin, anonymous, malformed, badSignature, stale, badCookie, brokenCookie, truncatedCookie, partialEscape)

      expect(foreign.status).toBe(403)
      expect(foreignWithToken.status).toBe(403)
      expect(missingOrigin.status).toBe(403)
      for (const rejected of [anonymous, malformed, badSignature, stale, badCookie, brokenCookie, truncatedCookie, partialEscape]) {
        expect(rejected.status).toBe(401)
        expect(JSON.parse(rejected.body).error).toEqual({ code: 'PIN_REQUIRED', message: 'PIN required' })
        expect(rejected.body).not.toMatch(/URIError|SyntaxError|stack|decodeURI/i)
      }
    } finally {
      for (const socket of opened) socket.close()
      await app.close()
      db.raw.close()
    }
  })

  it('accepts a bearer token or the session cookie and sends only refresh fields', async () => {
    const db = await openDatabase(':memory:')
    const { app, service } = await createApp({ db, testMode: true })
    const opened: Handshake[] = []
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
      const local = endpoint(app)
      service.importEvent({
        id: 'EV',
        name: 'Privacy',
        date: '2027-06-12',
        timezone: 'Europe/Helsinki',
        sport: 'run',
        races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
        categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
      })
      service.registerLate({
        firstName: 'Lotta',
        lastName: 'Hämäläinen',
        gender: 'M',
        birthDate: '2016-01-01',
        email: 'child@example.com',
        raceId: 'R1',
        bib: 90421,
        consent: false,
      })
      const entry = db.get<{ id: string }>('SELECT id FROM entry WHERE bib = ?', 90421)
      expect(entry?.id).toBeTruthy()
      const issued = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/pin/check',
        headers: { host: local.host, 'content-type': 'application/json' },
        payload: {},
      })
      expect(issued.statusCode).toBe(200)
      const token = issued.json().token as string
      const reason = 'guardian note: Salainen Lotta must stay off the socket'

      const bearer = await connect(app, { authorization: `Bearer ${token}` })
      const cookie = await connect(app, { cookie: `ert_session=${token}` })
      opened.push(bearer, cookie)
      expect(bearer.status).toBe(101)
      expect(cookie.status).toBe(101)
      await bearer.waitFor(1)
      await cookie.waitFor(1)

      const start = Date.parse('2027-06-12T10:00:00Z')
      service.startRace('R1', start)
      const finish = service.recordFinish({ timeMs: start + 60_000, bib: 90421 })
      service.setStatus(90421, 'dns', reason)
      await bearer.waitFor(5)

      expect(JSON.parse(cookie.frames[0])).toEqual({ type: 'device.status', payload: { proto: 1 } })
      const parsed = bearer.frames.map((frame) => JSON.parse(frame) as { type: string; payload: Record<string, unknown> })
      expect(parsed[0]).toEqual({ type: 'device.status', payload: { proto: 1 } })
      expect(parsed.filter((message) => message.type === 'timing_event.created')).toEqual([
        { type: 'timing_event.created', payload: { raceId: 'R1', kind: 'start' } },
        { type: 'timing_event.created', payload: { id: finish.id } },
      ])
      expect(parsed.filter((message) => message.type === 'results.updated')).toEqual([
        { type: 'results.updated', payload: { raceId: 'R1' } },
      ])
      expect(parsed.filter((message) => message.type === 'correction.created')).toEqual([
        { type: 'correction.created', payload: { action: 'set_status' } },
      ])

      const wire = bearer.frames.join('\n')
      expect(wire).not.toContain('Hämäläinen')
      expect(wire).not.toContain('Lotta')
      expect(wire).not.toContain('child@example.com')
      expect(wire).not.toContain('2016-01-01')
      expect(wire).not.toContain(reason)
      expect(wire).not.toContain('90421')
      expect(wire).not.toContain(entry?.id ?? 'missing-entry')
    } finally {
      for (const socket of opened) socket.close()
      await app.close()
      db.raw.close()
    }
  })
})
