import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '@ert/storage'
import { LOCAL_ROUTES, PROTECTED_ROUTES, PUBLIC_ROUTES, routeAccess } from './access.js'
import { createApp } from './app.js'

async function tokenFor(app: FastifyInstance, pin?: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/settings/pin/check',
    payload: pin ? { pin } : {},
  })
  expect(response.statusCode).toBe(200)
  return response.json().token as string
}

describe('device token', () => {
  it('classifies every route and refuses unclassified or anonymous writes', async () => {
    const db = await openDatabase(':memory:')
    const { app, discovered } = await createApp({ db, testMode: true })
    await app.ready()
    const api = discovered.filter((route) => route.url.startsWith('/api/') || route.url === '/ws')
    expect(api.length).toBeGreaterThan(0)
    for (const route of api) {
      expect(routeAccess(route.method, route.url), `${route.method} ${route.url}`).toBeDefined()
    }
    const known = new Set<string>([...PUBLIC_ROUTES, ...LOCAL_ROUTES, ...PROTECTED_ROUTES])
    for (const route of api) expect(known.has(`${route.method} ${route.url}`)).toBe(true)

    for (const key of PROTECTED_ROUTES) {
      const [method, url] = [key.split(' ')[0], key.slice(key.indexOf(' ') + 1).replaceAll(':id', 'x')]
      const headers: Record<string, string> = { host: 'localhost:80' }
      if (url === '/ws') headers.origin = 'http://localhost:80'
      const response = await app.inject({
        method: method as 'GET',
        url,
        headers,
        payload: method === 'GET' ? undefined : {},
      })
      expect(response.statusCode, key).toBe(401)
      expect(response.json().error.code).toBe('PIN_REQUIRED')
    }

    const internal = await app.inject({
      method: 'GET',
      url: '/api/v1/results?view=internal',
      headers: { host: 'localhost:80' },
    })
    expect(internal.statusCode).toBe(401)

    const remoteRuntime = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime',
      headers: { host: 'localhost:80' },
      remoteAddress: '8.8.8.8',
    })
    expect(remoteRuntime.statusCode).toBe(401)

    const health = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json().pinConfigured).toBe(false)
    db.raw.close()
    await app.close()
  })

  it('sets an HttpOnly Strict cookie and requires the current PIN to change it', async () => {
    const db = await openDatabase(':memory:')
    const { app, service } = await createApp({ db, testMode: true })
    service.importEvent({
      id: 'EV', name: 'PIN', date: '2027-06-12', timezone: 'Europe/Helsinki', sport: 'run', races: [], categories: [],
    })
    const first = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: {} })
    const cookie = String(first.headers['set-cookie'])
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('SameSite=Lax')
    const token = first.json().token as string
    const auth = { authorization: `Bearer ${token}`, host: 'localhost:80' }

    const missing = await app.inject({ method: 'POST', url: '/api/v1/settings/pin', headers: { host: 'localhost:80' }, payload: { pin: '1234' } })
    expect(missing.statusCode).toBe(401)

    const set = await app.inject({ method: 'POST', url: '/api/v1/settings/pin', headers: auth, payload: { pin: '1234' } })
    expect(set.statusCode).toBe(200)

    const noCurrent = await app.inject({ method: 'POST', url: '/api/v1/settings/pin', headers: auth, payload: { pin: '5678' } })
    expect(noCurrent.statusCode).toBe(401)
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/settings/pin', headers: auth, payload: { pin: '5678', currentPin: '0000' } })
    expect(wrong.statusCode).toBe(401)
    const changed = await app.inject({ method: 'POST', url: '/api/v1/settings/pin', headers: auth, payload: { pin: '5678', currentPin: '1234' } })
    expect(changed.statusCode).toBe(200)

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { host: 'localhost:80' } })
    expect(anonymous.statusCode).toBe(401)
    const opened = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: auth })
    expect(opened.statusCode).toBe(200)
    const runtime = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime',
      headers: auth,
      remoteAddress: '8.8.8.8',
    })
    expect(runtime.statusCode).toBe(200)
    const internal = await app.inject({ method: 'GET', url: '/api/v1/results?view=internal', headers: auth })
    expect(internal.statusCode).not.toBe(401)
    db.raw.close()
    await app.close()
  })

  it('issues a token from a checked PIN', async () => {
    const db = await openDatabase(':memory:')
    const { app, service } = await createApp({ db, testMode: true })
    service.importEvent({
      id: 'EV', name: 'PIN', date: '2027-06-12', timezone: 'Europe/Helsinki', sport: 'run', races: [], categories: [],
    })
    const setup = await tokenFor(app)
    await app.inject({
      method: 'POST',
      url: '/api/v1/settings/pin',
      headers: { authorization: `Bearer ${setup}` },
      payload: { pin: '1234' },
    })
    const denied = await app.inject({ method: 'POST', url: '/api/v1/settings/pin/check', payload: { pin: '0000' } })
    expect(denied.statusCode).toBe(401)
    const token = await tokenFor(app, '1234')
    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { cookie: `ert_session=${token}` },
    })
    expect(bootstrap.statusCode).toBe(200)
    db.raw.close()
    await app.close()
  })
})
