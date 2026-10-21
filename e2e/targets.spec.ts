// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { smallTargets, violations } from './a11y.ts'
import { killServer, startServer, type RunningServer } from './server.ts'

const views = ['/office', '/import', '/entries', '/start', '/finish', '/corrections', '/ties', '/clubs', '/results', '/print', '/audit'] as const

test.describe('touch targets', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8102, path.join(mkdtempSync(path.join(tmpdir(), 'ert-targets-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('keeps main-view controls at least 44 px in both themes', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${server.port}/`)
    await expect(page.getByTestId('wizard')).toBeVisible()
    await expectSized(page, 'wizard')
    await page.getByTestId('nav-import').click()
    await expect(page.getByTestId('event-file')).toBeVisible()
    await expectSized(page, 'import')

    await page.goto(`http://127.0.0.1:${server.port}/`)
    await page.getByTestId('wizard-name').fill('Target Race')
    await page.getByTestId('wizard-date').fill('2027-06-12')
    await page.getByTestId('wizard-place').fill('Test')
    await page.getByTestId('wizard-organizer').fill('Test Club')
    await page.getByTestId('wizard-next').click()
    await page.getByTestId('wizard-next').click()
    await page.getByTestId('wizard-create').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Target Race' })).toBeVisible()
    await expect(page.getByTestId('wizard-next-import')).toBeVisible()
    await expect(page.getByTestId('source-link')).toBeVisible()

    for (const route of views) {
      await page.goto(`http://127.0.0.1:${server.port}/#${route}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      if (route === '/entries') await expect(page.getByTestId('late-consent')).toBeVisible()
      if (route === '/results') await expect(page.getByTestId('results-csv')).toBeVisible()
      await expectSized(page, route)
    }
  })
})

async function expectSized(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.getByTestId(`theme-${theme}`).click()
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      const where = `${label} ${theme} ${width}`
      expect(await smallTargets(page), where).toEqual([])
      expect(await violations(page), where).toEqual([])
    }
  }
}
