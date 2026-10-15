import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { screenshotDir } from './screenshot-dir.ts'
import { killServer, startServer, type RunningServer } from './server.ts'

test.describe('first run', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8098, path.join(mkdtempSync(path.join(tmpdir(), 'ert-wizard-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('creates a race without a file import', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${server.port}/`)
    await expect(page.getByTestId('wizard')).toBeVisible()
    await page.getByTestId('theme-light').click()
    const shots = screenshotDir()
    await page.screenshot({ path: path.join(shots, 'wizard-light.png'), fullPage: true })
    await page.getByTestId('theme-dark').click()
    await page.screenshot({ path: path.join(shots, 'wizard-dark.png'), fullPage: true })
    await page.getByTestId('theme-light').click()
    await expect(page.getByTestId('nav-finish')).toHaveCount(0)
    await page.getByTestId('wizard-name').fill('Kuulan hölkkä')
    await page.getByTestId('wizard-date').fill('2027-06-12')
    await page.getByTestId('wizard-place').fill('Uurainen')
    await page.getByTestId('wizard-organizer').fill('Uuraisten Urheilijat')
    await page.getByTestId('wizard-next').click()
    await expect(page.getByTestId('wizard-start-R4')).toHaveValue('11:00')
    await expect(page.getByTestId('wizard-start-R8')).toHaveValue('11:30')
    await page.getByTestId('wizard-next').click()
    await expect(page.getByTestId('wizard-summary')).toContainText('Kuulan hölkkä')
    await page.getByTestId('wizard-create').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Kuulan hölkkä' })).toBeVisible()
    await expect(page.getByTestId('wizard-next-import')).toBeVisible()
    await expect(page.getByTestId('nav-finish')).toBeVisible()
    const runtime = await page.request.get(`http://127.0.0.1:${server.port}/api/v1/runtime`)
    expect(runtime.ok()).toBeTruthy()
    const body = await runtime.json() as { url: string; dbPath: string }
    expect(body.url).toBe(`http://127.0.0.1:${server.port}`)
    expect(body.dbPath.endsWith('ert.sqlite')).toBeTruthy()
  })
})
