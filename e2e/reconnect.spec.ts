// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { APIRequestContext, Page, WebSocketRoute } from '@playwright/test'
import { violations } from './a11y.ts'
import { expect, test } from './fixtures.ts'
import { authorize, killServer, seedMassStart, startServer, type RunningServer } from './server.ts'

const fiNotice = 'Yhteys katkesi – yhdistetään uudelleen…'
const enNotice = 'Connection lost – reconnecting…'

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
  const start = await seedMassStart(request, { id: 'EV_LIVE', name: 'Live-kisa', bibs: [42], startAgoMs: 60_000 })
  const gate = await openFinish(page)
  await postFinish(request, 'F100', start + 10_000)
  await expect(page.getByTestId('finish-row-F100')).toContainText('42')
  const notice = page.getByTestId('connection-status')
  await expect(notice).toBeAttached()
  await expect(notice).toHaveText('')
  await showNotice(page, gate)
  await expect(page.getByTestId('finish-row-F100')).toContainText('42')
  await recoverFreshFinish(page, request, start, gate)
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

async function openFinish(page: Page): Promise<{ accept: { value: boolean }; sockets: WebSocketRoute[] }> {
  const gate = { accept: { value: true }, sockets: [] as WebSocketRoute[] }
  await page.routeWebSocket(/\/ws/, (ws) => {
    if (!gate.accept.value) {
      void ws.close({ code: 1011, reason: 'unavailable' })
      return
    }
    gate.sockets.push(ws)
    ws.connectToServer()
  })
  await page.addInitScript(() => localStorage.setItem('ert-theme', 'light'))
  const opened = page.waitForEvent('websocket')
  await page.goto('/')
  const socket = await opened
  await socket.waitForEvent('framereceived')
  await page.getByTestId('nav-finish').click()
  return gate
}

async function postFinish(request: APIRequestContext, id: string, timeMs: number): Promise<void> {
  expect((await request.post('/api/v1/timing-events', {
    data: { id, timeMs, bib: 42, mode: 'time_first' },
  })).ok()).toBeTruthy()
}

async function showNotice(page: Page, gate: { accept: { value: boolean }; sockets: WebSocketRoute[] }): Promise<void> {
  gate.accept.value = false
  await gate.sockets.at(-1)?.close({ code: 1001, reason: 'restart' })
  const notice = page.getByTestId('connection-status')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveText(fiNotice)
  await expect(notice).toHaveAttribute('role', 'status')
  await expect(notice).toHaveAttribute('aria-live', 'polite')
  await page.getByTestId('lang-en').click()
  await expect(notice).toHaveText(enNotice)
  await page.getByTestId('lang-fi').click()
  await expect(notice).toHaveText(fiNotice)
  expect(await violations(page), 'light').toEqual([])
  await page.getByTestId('theme-dark').click()
  expect(await violations(page), 'dark').toEqual([])
}

async function recoverFreshFinish(
  page: Page,
  request: APIRequestContext,
  start: number,
  gate: { accept: { value: boolean } },
): Promise<void> {
  await killServer(server)
  server = await startServer(8103, server.dbFile)
  await authorize(request)
  await postFinish(request, 'F101', start + 20_000)
  gate.accept.value = true
  await expect(page.getByTestId('finish-row-F101')).toContainText('42', { timeout: 25_000 })
  await expect(page.getByTestId('finish-row-F100')).toContainText('42')
  await expect(page.getByTestId('connection-status')).toHaveText('')
  expect(await violations(page), 'reconnected').toEqual([])
}
