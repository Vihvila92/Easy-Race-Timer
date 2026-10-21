import { expect, test } from './fixtures.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { screenshotDir } from './screenshot-dir.ts'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

const out = screenshotDir()
const dir = path.resolve('testdata/kuulan-holkka')

test.describe('screenshots', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8099, path.join(mkdtempSync(path.join(tmpdir(), 'ert-shot-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('captures the main screens in light and dark', async ({ page, request }) => {
    await authorize(request)
    const event = JSON.parse(await (await import('node:fs')).promises.readFile(path.join(dir, 'event.json'), 'utf8'))
    const clubs = JSON.parse(await (await import('node:fs')).promises.readFile(path.join(dir, 'clubs-registry.json'), 'utf8'))
    const csv = await (await import('node:fs')).promises.readFile(path.join(dir, 'entries.csv'), 'utf8')
    expect((await request.post('/api/v1/events/import', { data: event })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/clubs/import', { data: { clubs: clubs.clubs } })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/entries/import', { data: { csv } })).ok()).toBeTruthy()
    const start = Date.parse('2027-06-12T11:00:00.412+03:00')
    expect((await request.post('/api/v1/races/R4/start', { data: { timeMs: start } })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/timing-events', { data: { id: 'S1', timeMs: start + 22 * 60_000 + 13_240, bib: 129 } })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/timing-events', { data: { id: 'S2', timeMs: start + 22 * 60_000 + 13_780, bib: 130 } })).ok()).toBeTruthy()

    await page.goto('/')
    for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId('nav-office').click()
      await page.screenshot({ path: path.join(out, `office-${theme}.png`), fullPage: true })
      await page.getByTestId('nav-finish').click()
      await page.screenshot({ path: path.join(out, `finish-${theme}.png`), fullPage: true })
      await page.getByTestId('nav-results').click()
      await page.screenshot({ path: path.join(out, `results-${theme}.png`), fullPage: true })
      await page.getByTestId('nav-ties').click()
      await page.screenshot({ path: path.join(out, `ties-${theme}.png`), fullPage: true })
    }
  })
})
