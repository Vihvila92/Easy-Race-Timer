// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { killServer, startServer, type RunningServer } from './server.ts'

test.describe('theme control', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8101, path.join(mkdtempSync(path.join(tmpdir(), 'ert-theme-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('shows the selected theme only as aria-pressed', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${server.port}/`)
    await expect(page.getByTestId('wizard')).toBeVisible()
    await expect(page.getByTestId('theme-value')).toHaveCount(0)
    await expect(page.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'false')

    await page.getByTestId('theme-light').click()
    await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('settings')).not.toContainText(/(?:^|\s)(?:light|dark|system)(?:\s|$)/)

    await page.getByTestId('theme-dark').click()
    await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('settings')).not.toContainText(/(?:^|\s)(?:light|dark|system)(?:\s|$)/)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.getByTestId('nav-import').click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('theme-value')).toHaveCount(0)
    await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'true')
  })
})
