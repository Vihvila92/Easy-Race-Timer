// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { smallTargets, violations } from './a11y.ts'
import { expect, test } from './fixtures.ts'
import { killServer, startServer, type RunningServer } from './server.ts'

const root = path.resolve(import.meta.dirname, '..')
const FIRST = 'correct-horse-battery'
const SECOND = 'staple-river-margin'
const NEXT = 'replacement-admin-password'
const PORT = 8104

function protectedFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'e2e/create-protected.ts'], {
      cwd: root,
      env: { ...process.env, ERT_E2E_FILE: file, ERT_E2E_FIRST: FIRST, ERT_E2E_SECOND: SECOND },
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString() })
    child.on('exit', (code) => (code === 0 && out ? resolve(out) : reject(new Error(err || `create failed ${code}`))))
  })
}

async function expectClean(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.getByTestId(`theme-${theme}`).click()
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 })
      expect(await violations(page), `${label} ${theme} ${width}`).toEqual([])
      expect(await smallTargets(page), `${label} ${theme} ${width}`).toEqual([])
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
      expect(overflow.scroll, `${label} ${theme} ${width}`).toBeLessThanOrEqual(overflow.client)
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByTestId('theme-light').click()
}

async function restart(server: RunningServer, file: string): Promise<RunningServer> {
  await killServer(server)
  return startServer(PORT, file, { ERT_DEV_KEY: '' })
}

async function openWithPassword(page: Page, password: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await expect(page.getByTestId('unlock-panel')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await page.getByTestId('lang-en').click()
  await expectClean(page, 'unlock')
  await page.getByTestId('unlock-password').fill(password)
  await page.getByTestId('unlock-recovery').click()
  await expect(page.getByTestId('recovery-key')).toHaveValue('')
  await page.getByTestId('unlock-back').click()
  await page.getByTestId('unlock-password').fill(password)
  await page.getByTestId('unlock-password').press('Enter')
  await expect(page.getByTestId('wizard')).toBeVisible()
}

async function setPasswordFromPaper(page: Page, recoveryKey: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.getByTestId('lang-en').click()
  await page.getByTestId('unlock-recovery').click()
  await page.getByTestId('recovery-key').fill(recoveryKey)
  await page.getByTestId('recovery-key').press('Enter')
  await expect(page.getByTestId('recovery-gate')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await page.getByTestId('gate-password').fill(NEXT)
  await page.getByTestId('gate-confirm').fill(NEXT)
  await page.getByTestId('gate-confirm').press('Enter')
  await expect(page.getByTestId('wizard')).toBeVisible()
}

async function printAndAcknowledge(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${PORT}/#/keys`)
  const rotation = page.getByTestId('key-rotation')
  await expect(rotation.getByLabel("The other admin's current password")).toBeVisible()
  await page.getByTestId('other-mode').selectOption('temporary')
  await expect(rotation.getByLabel('New password')).toBeVisible()
  await page.getByTestId('rotate-save').click()
  await expect(page.getByTestId('rotate-confirm-warning')).toContainText('Changing the data key')
  await page.getByTestId('regenerate-password').fill(NEXT)
  await page.getByTestId('recovery-regenerate').click()
  await page.getByTestId('recovery-regenerate-confirm').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Recovery key' })).toBeVisible()
  const shown = page.getByTestId('recovery-key-display')
  const keyText = (await shown.innerText()).replace(/\s+/g, '')
  expect(keyText.length).toBeGreaterThan(20)
  await expectClean(page, 'print')
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('recovery-ack-submit')).toBeHidden()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)')
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(shown).toHaveCount(0)
  await expect(page.getByTestId('recovery-ack-submit')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(keyText.slice(0, 8))
  await page.getByTestId('recovery-ack').check()
  await page.getByTestId('recovery-ack-submit').click()
  await expect(page.getByTestId('key-manage')).toBeVisible()
}

test.describe('key views', () => {
  let server: RunningServer
  let recoveryKey = ''
  let file = ''

  test.beforeAll(async () => {
    file = path.join(mkdtempSync(path.join(tmpdir(), 'ert-keys-')), 'ert.sqlite')
    recoveryKey = await protectedFile(file)
    server = await startServer(PORT, file, { ERT_DEV_KEY: '' })
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('opens with a password, then with the recovery key, and acknowledges the printed key', async ({ page }) => {
    await openWithPassword(page, FIRST)
    server = await restart(server, file)
    await setPasswordFromPaper(page, recoveryKey)
    await printAndAcknowledge(page)
    server = await restart(server, file)
    await page.goto(`http://127.0.0.1:${PORT}/`)
    await page.getByTestId('lang-en').click()
    await page.getByTestId('unlock-password').fill(NEXT)
    await page.getByTestId('unlock-open').click()
    await expect(page.getByTestId('wizard')).toBeVisible()
  })
})
