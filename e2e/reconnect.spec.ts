// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WebSocketRoute } from '@playwright/test'
import { violations } from './a11y.ts'
import { expect, test } from './fixtures.ts'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

const fiNotice = 'Yhteys katkesi – yhdistetään uudelleen…'
const enNotice = 'Connection lost – reconnecting…'

test.describe('live socket reconnect', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ baseURL: 'http://127.0.0.1:8103' })

  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8103, path.join(mkdtempSync(path.join(tmpdir(), 'ert-reconnect-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('shows a polite notice when the socket drops and recovers with fresh data', async ({ page, request }) => {
    await authorize(request)
    expect((await request.post('/api/v1/events/import', {
      data: {
        id: 'EV_LIVE',
        name: 'Live-kisa',
        date: '2027-06-12',
        timezone: 'Europe/Helsinki',
        sport: 'run',
        races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
        categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
      },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/entries/late', {
      data: { firstName: 'Aino', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 42, consent: false },
    })).ok()).toBeTruthy()
    const start = Date.now() - 60_000
    expect((await request.post('/api/v1/races/R1/start', { data: { timeMs: start } })).ok()).toBeTruthy()

    let accept = true
    const sockets: WebSocketRoute[] = []
    await page.routeWebSocket(/\/ws/, (ws) => {
      if (!accept) {
        void ws.close({ code: 1011, reason: 'unavailable' })
        return
      }
      sockets.push(ws)
      ws.connectToServer()
    })

    await page.addInitScript(() => localStorage.setItem('ert-theme', 'light'))
    const opened = page.waitForEvent('websocket')
    await page.goto('/')
    const socket = await opened
    await socket.waitForEvent('framereceived')
    await page.getByTestId('nav-finish').click()

    expect((await request.post('/api/v1/timing-events', {
      data: { id: 'F100', timeMs: start + 10_000, bib: 42, mode: 'time_first' },
    })).ok()).toBeTruthy()
    await expect(page.getByTestId('finish-row-F100')).toContainText('42')
    await expect(page.getByTestId('connection-status')).toHaveCount(0)

    accept = false
    await sockets.at(-1)?.close({ code: 1001, reason: 'restart' })
    const notice = page.getByTestId('connection-status')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(fiNotice)
    await expect(notice).toHaveAttribute('role', 'status')
    await expect(notice).toHaveAttribute('aria-live', 'polite')
    await expect(page.getByTestId('finish-row-F100')).toContainText('42')

    await page.getByTestId('lang-en').click()
    await expect(notice).toHaveText(enNotice)
    await page.getByTestId('lang-fi').click()
    await expect(notice).toHaveText(fiNotice)
    expect(await violations(page), 'light').toEqual([])
    await page.getByTestId('theme-dark').click()
    expect(await violations(page), 'dark').toEqual([])

    await killServer(server)
    server = await startServer(8103, server.dbFile)
    await authorize(request)
    expect((await request.post('/api/v1/timing-events', {
      data: { id: 'F101', timeMs: start + 20_000, bib: 42, mode: 'time_first' },
    })).ok()).toBeTruthy()
    accept = true

    await expect(page.getByTestId('finish-row-F101')).toContainText('42', { timeout: 25_000 })
    await expect(page.getByTestId('finish-row-F100')).toContainText('42')
    await expect(notice).toHaveCount(0)
    expect(await violations(page), 'reconnected').toEqual([])
  })

  test('does not reconnect for 60 seconds after close 4401', async ({ page }) => {
    let opened = 0
    await page.clock.install()
    await page.routeWebSocket(/\/ws/, (ws) => {
      opened += 1
      void ws.close({ code: 4401, reason: 'expired' })
    })
    await page.goto('/')
    await expect(page.getByTestId('pin-gate')).toBeVisible()
    await expect(page.getByTestId('connection-status')).toHaveCount(0)
    const afterGate = opened
    expect(afterGate).toBeGreaterThan(0)
    await page.clock.runFor(60_000)
    expect(opened).toBe(afterGate)
  })
})
