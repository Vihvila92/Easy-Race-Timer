// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InjectOptions } from 'fastify'
import { openDatabase } from '@ert/storage'
import { createApp } from './app.js'
import { Clock, RaceService } from './service.js'

function expectSecurityHeaders(headers: Record<string, unknown>) {
  const csp = String(headers['content-security-policy'] ?? '')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("connect-src 'self'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).not.toContain('upgrade-insecure-requests')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('no-referrer')
}

describe('security headers', () => {
  it('sets CSP, nosniff, and Referrer-Policy on API, HTML results, errors, and pages', async () => {
    const db = await openDatabase(':memory:')
    new RaceService(db, new Clock()).importEvent({
      id: 'EV',
      name: 'Headers',
      date: '2027-06-12',
      timezone: 'Europe/Helsinki',
      sport: 'run',
      races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
      categories: [{ id: 'M', race_id: 'R1', name: { fi: 'Miehet', en: 'Men' }, gender: 'M', min_age: 0 }],
    })
    const dir = mkdtempSync(path.join(tmpdir(), 'ert-headers-'))
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Easy Race Timer</title>')
    const { app } = await createApp({ db, testMode: true, webDist: dir })

    const requests: InjectOptions[] = [
      { method: 'GET', url: '/api/v1/health' },
      { method: 'HEAD', url: '/api/v1/health' },
      { method: 'GET', url: '/api/v1/results?format=html' },
      { method: 'GET', url: '/api/v1/results?format=csv' },
      { method: 'GET', url: '/api/v1/bootstrap' },
      { method: 'GET', url: '/api/v1/missing' },
      { method: 'GET', url: '/' },
      { method: 'GET', url: '/office' },
      { method: 'GET', url: '/api/v1/health', headers: { host: 'evil.example' } },
    ]
    for (const options of requests) {
      const response = await app.inject(options)
      expectSecurityHeaders(response.headers)
    }

    const html = await app.inject({ method: 'GET', url: '/api/v1/results?format=html' })
    expect(html.statusCode).toBe(200)
    expect(String(html.headers['content-type'])).toContain('text/html')
    expect(html.body).toContain('Headers')
    const denied = await app.inject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(denied.statusCode).toBe(401)
    const foreign = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: 'evil.example' } })
    expect(foreign.statusCode).toBe(421)
    const page = await app.inject({ method: 'GET', url: '/' })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('Easy Race Timer')
  })
})
