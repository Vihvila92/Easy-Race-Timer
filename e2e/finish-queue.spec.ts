// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

test.describe('finish queue', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8099, path.join(mkdtempSync(path.join(tmpdir(), 'ert-queue-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('keeps a tap made offline and syncs the client timestamp', async ({ page, context, request }) => {
    await authorize(request)
    expect((await request.post('/api/v1/events/import', {
      data: {
        id: 'EV_QUEUE',
        name: 'Jono',
        date: '2027-06-12',
        timezone: 'Europe/Helsinki',
        sport: 'run',
        races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
        categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
      },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/entries/late', {
      data: { firstName: 'Aino', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 105, consent: false },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/entries/late', {
      data: { firstName: 'Toinen', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 106, consent: false },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/races/R1/start', { data: { timeMs: Date.now() - 60_000 } })).ok()).toBeTruthy()

    await page.goto('/')
    await page.getByTestId('nav-finish').click()
    const stamped = await page.evaluate(() => Date.now())
    await context.setOffline(true)
    await page.getByTestId('finish-bib').fill('105')
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId('queue-count')).toContainText('1')
    const queued = await readQueue(page)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.synced).toBe(false)
    expect(queued[0]?.timeMs).toBeGreaterThanOrEqual(stamped)
    expect(queued[0]!.timeMs - stamped).toBeLessThan(5_000)
    expect(String(queued[0]?.id)).toContain(':')
    const during = await request.get('/api/v1/timing-events')
    const pending = (await during.json() as { bib: number | null; mode: string | null }[]).filter((event) => event.bib === 105)
    expect(pending).toHaveLength(0)

    await context.setOffline(false)
    await page.reload()
    await page.getByTestId('nav-finish').click()
    await expect(page.getByTestId('queue-count')).toContainText('0')
    const after = await request.get('/api/v1/timing-events')
    const saved = (await after.json() as { id: string; bib: number | null; time_ms: number }[]).filter((event) => event.bib === 105)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.time_ms).toBe(queued[0]?.timeMs)
    expect(saved[0]?.id).toBe(queued[0]?.id)
  })

  test('keeps finish taps from two tabs', async ({ page, request }) => {
    await authorize(request)
    await page.goto('/')
    await page.getByTestId('nav-finish').click()
    const other = await page.context().newPage()
    await other.goto('/')
    await other.getByTestId('nav-finish').click()
    await page.getByTestId('finish-bib').fill('106')
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId('finish-recorded')).toContainText('Aika kirjattu')
    await other.getByTestId('finish-bib').fill('106')
    await other.getByTestId('finish-tap').click()
    await expect(other.getByTestId('finish-recorded')).toBeVisible()
    await page.reload()
    await page.getByTestId('nav-finish').click()
    const listed = await request.get('/api/v1/timing-events')
    const taps = (await listed.json() as { id: string; bib: number | null; mode: string | null }[])
      .filter((event) => event.bib === 106 && event.mode === 'time_first')
    expect(taps).toHaveLength(2)
    expect(new Set(taps.map((event) => event.id)).size).toBe(2)
    expect(taps.every((event) => event.id.includes(':'))).toBe(true)
    await other.close()
  })

  test('corrects a finish when the device clock is 90 seconds ahead', async ({ page, request }) => {
    await authorize(request)
    expect((await request.post('/api/v1/entries/late', {
      data: { firstName: 'Kello', lastName: 'Edellä', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 107, consent: false },
    })).ok()).toBeTruthy()
    const real = Date.now()
    await page.clock.install({ time: real + 90_000 })
    await page.clock.resume()
    await page.goto('/')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ert-clock-offset'))).toBeTruthy()
    await page.getByTestId('nav-finish').click()
    await expect(page.getByTestId('clock-offset')).toBeVisible()
    const before = Date.now()
    await page.getByTestId('finish-bib').fill('107')
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId('finish-recorded')).toBeVisible()
    const after = Date.now()
    const listed = await request.get('/api/v1/timing-events')
    const saved = (await listed.json() as { bib: number | null; time_ms: number; device_time_ms: number }[])
      .filter((event) => event.bib === 107)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.time_ms).toBeGreaterThanOrEqual(before - 2_000)
    expect(saved[0]!.time_ms).toBeLessThanOrEqual(after + 2_000)
    expect(saved[0]!.device_time_ms - saved[0]!.time_ms).toBeGreaterThan(80_000)
    expect(saved[0]!.device_time_ms - saved[0]!.time_ms).toBeLessThan(100_000)
  })
})

async function readQueue(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ert-queue', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rows = await new Promise<{ id: string; timeMs: number; synced: boolean }[]>((resolve, reject) => {
      const request = db.transaction('taps').objectStore('taps').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return rows
  })
}
