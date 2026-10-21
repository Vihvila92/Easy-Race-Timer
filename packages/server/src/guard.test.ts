// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { hostAllowed, jsonContentType, originAllowed } from './guard.js'

describe('request guards', () => {
  it('allows only loopback hosts on the listening port', () => {
    expect(hostAllowed('127.0.0.1:8080', 8080)).toBe(true)
    expect(hostAllowed('localhost:8080', 8080)).toBe(true)
    expect(hostAllowed('[::1]:8080', 8080)).toBe(true)
    expect(hostAllowed('evil.example', 8080)).toBe(false)
    expect(hostAllowed('127.0.0.1:9999', 8080)).toBe(false)
    expect(hostAllowed('localhost:80', null)).toBe(true)
  })

  it('checks origin against loopback and the extra dev origins', () => {
    expect(originAllowed('http://127.0.0.1:8080', 8080)).toBe(true)
    expect(originAllowed('http://localhost:8080', 8080)).toBe(true)
    expect(originAllowed('http://evil.example', 8080)).toBe(false)
    expect(originAllowed('http://localhost:5173', 8080, ['http://localhost:5173'])).toBe(true)
    expect(originAllowed(undefined, 8080)).toBe(false)
  })

  it('accepts application/json with an optional charset', () => {
    expect(jsonContentType('application/json')).toBe(true)
    expect(jsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(jsonContentType('text/plain')).toBe(false)
    expect(jsonContentType(undefined)).toBe(false)
  })
})

describe('HTTP guards', () => {
  it('rejects a foreign host, a foreign origin, a text body, and a foreign websocket origin', async () => {
    const db = await openDatabase(':memory:')
    const { app } = await createApp({ db, testMode: true })
    const host = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { host: 'evil.example' },
    })
    expect(host.statusCode).toBe(421)

    const origin = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/pin/check',
      headers: { host: 'localhost:80', origin: 'http://evil.example', 'content-type': 'application/json' },
      payload: {},
    })
    expect(origin.statusCode).toBe(403)

    const text = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/pin/check',
      headers: { host: 'localhost:80', 'content-type': 'text/plain' },
      payload: 'pin=1234',
    })
    expect(text.statusCode).toBe(415)

    const socket = await app.inject({
      method: 'GET',
      url: '/ws',
      headers: {
        host: 'localhost:80',
        upgrade: 'websocket',
        connection: 'upgrade',
        origin: 'http://evil.example',
      },
    })
    expect(socket.statusCode).toBe(403)

    const health = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: 'localhost:80' } })
    expect(health.statusCode).toBe(200)
    db.raw.close()
    await app.close()
  })
})
