import { expect, test } from './fixtures.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

test.describe('admin PIN', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8099, path.join(mkdtempSync(path.join(tmpdir(), 'ert-pin-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('keeps the office behind the PIN and accepts the right one', async ({ page, request }) => {
    await authorize(request)
    expect((await request.post('/api/v1/events/import', {
      data: {
        id: 'EV_PIN',
        name: 'Pin-kisa',
        date: '2027-06-12',
        timezone: 'Europe/Helsinki',
        sport: 'run',
        races: [],
        categories: [],
      },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/settings/pin', { data: { pin: '2468' } })).ok()).toBeTruthy()

    await page.goto('/')
    await expect(page.getByTestId('pin-gate')).toBeVisible()
    await page.getByTestId('pin-input').fill('0000')
    await page.getByTestId('pin-submit').click()
    await expect(page.getByTestId('form-error')).toContainText('PIN_REQUIRED')
    await page.getByTestId('pin-input').fill('2468')
    await page.getByTestId('pin-submit').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Pin-kisa' })).toBeVisible()
  })
})