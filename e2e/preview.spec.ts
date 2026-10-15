import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { killServer, startServer, type RunningServer } from './server.ts'

const root = path.resolve(import.meta.dirname, '..')
const devOrigin = 'http://127.0.0.1:5174'

test.describe('component preview', () => {
  let server: RunningServer
  let vite: ChildProcess

  test.beforeAll(async () => {
    server = await startServer(8096, path.join(mkdtempSync(path.join(tmpdir(), 'ert-preview-')), 'ert.sqlite'))
    vite = await startVite(5174, server.port)
  })

  test.afterAll(async () => {
    if (vite && vite.exitCode == null) {
      vite.kill('SIGKILL')
      await new Promise((resolve) => vite.once('exit', resolve))
    }
    if (server) await killServer(server)
  })

  test('production build does not register the preview route', async ({ page }) => {
    const bundled = productionJavaScript()
    expect(bundled).not.toContain('component-preview')
    expect(bundled).not.toContain('nav-preview')
    expect(bundled).not.toContain('preview-hint')
    expect(bundled).not.toContain('#/preview')

    await openProduction(page, server.port)
    await expect(page.getByTestId('nav-preview')).toHaveCount(0)
    await expect(page.getByTestId('component-preview')).toHaveCount(0)
    await expect(page.getByTestId('wizard')).toBeVisible()
  })

  test('shows the shared controls, both languages, and an inline guided hint', async ({ page }) => {
    await openDev(page)
    await expect(page.getByTestId('component-preview')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Komponentit' })).toBeVisible()
    await expect(page.getByTestId('preview-hint')).toHaveText('Kirjoita nimi ja valitse matka. Vihje näkyy vain ohjatussa tilassa.')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('preview-clock')).toContainText('14.30')

    await page.getByTestId('lang-en').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible()
    await expect(page.getByTestId('preview-hint')).toContainText('guided mode')
    await expect(page.getByTestId('preview-clock')).toContainText('14:30')
    await page.getByTestId('lang-fi').click()
    await expect(page.getByTestId('preview-primary')).toHaveText('Jatka')

    await page.getByTestId('preview-name').fill('Aino')
    await page.getByTestId('preview-distance').selectOption('long')
    await page.getByTestId('guidance-expert').click()
    await expect(page.getByTestId('preview-hint')).toHaveCount(0)
    await expect(page.getByTestId('preview-name')).toHaveValue('Aino')
    await expect(page.getByTestId('preview-distance')).toHaveValue('long')
    await expect(page).toHaveURL(/#\/preview$/)
    await page.getByTestId('guidance-guided').click()
    await expect(page.getByTestId('preview-hint')).toBeVisible()
    await expect(page.getByTestId('preview-name')).toHaveValue('Aino')
    await expect(page.getByTestId('preview-distance')).toHaveValue('long')

    await page.getByTestId('preview-name').click()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('preview-distance')).toBeFocused()
    const outline = await page.getByTestId('preview-distance').evaluate((el) => {
      const style = getComputedStyle(el)
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(3)
    await page.getByTestId('preview-primary').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('preview-done')).toHaveText('Jatkettu')
    await page.getByTestId('preview-row').focus()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('preview-row')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('preview-name')).toHaveValue('Aino')
  })

  test('meets contrast, target size and 375 px width in both themes', async ({ page }) => {
    await openDev(page)
    await expect(page.getByTestId('preview-hint')).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId(`theme-${theme}`).click()
      await page.setViewportSize({ width: 1280, height: 800 })
      expect(await violations(page), theme).toEqual([])
      await page.setViewportSize({ width: 375, height: 800 })
      expect(await violations(page), `${theme} 375`).toEqual([])
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }))
      expect(overflow.scroll, theme).toBeLessThanOrEqual(overflow.client)
      expect(await smallTargets(page), theme).toEqual([])
    }
  })

  test('keeps a long clock on one line when the screen is narrow or zoomed', async ({ page }) => {
    await openDev(page)
    await page.locator('.ui-clock-value').evaluate((el) => {
      el.textContent = '10:59:59,9'
    })
    for (const width of [320, 240]) {
      await page.setViewportSize({ width, height: 700 })
      expect(await clockLine(page), `width ${width}`).toMatchObject({ lines: 1, nowrap: true, tabular: true })
    }
    await page.setViewportSize({ width: 375, height: 800 })
    await page.evaluate(() => { document.documentElement.style.zoom = '200%' })
    expect(await clockLine(page), '200% zoom').toMatchObject({ lines: 1, nowrap: true, tabular: true })
  })

  test('follows the system appearance until the user overrides it', async ({ page }) => {
    await openDev(page)
    await page.getByTestId('theme-system').click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    await page.getByTestId('theme-dark').click()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await expect(page.getByTestId('preview-name')).toHaveValue('')
  })
})

function productionJavaScript(): string {
  const dist = path.join(root, 'packages/web/dist')
  const files = [path.join(dist, 'index.html')]
  const assets = path.join(dist, 'assets')
  for (const name of readdirSync(assets)) {
    if (name.endsWith('.js')) files.push(path.join(assets, name))
  }
  return files.map((file) => readFileSync(file, 'utf8')).join('\n')
}

async function openProduction(page: Page, port: number): Promise<void> {
  const origin = `http://127.0.0.1:${port}`
  const auth = await page.request.post(`${origin}/api/v1/settings/pin/check`, { data: {} })
  expect(auth.ok()).toBeTruthy()
  await page.goto(`${origin}/#/preview`)
}

async function openDev(page: Page): Promise<void> {
  const auth = await page.request.post(`${devOrigin}/api/v1/settings/pin/check`, { data: {} })
  expect(auth.ok()).toBeTruthy()
  await page.goto(`${devOrigin}/#/preview`)
}

async function startVite(port: number, apiPort: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    '--port', String(port),
    '--strictPort',
    '--host', '127.0.0.1',
  ], {
    cwd: path.join(root, 'packages/web'),
    env: { ...process.env, ERT_DEV_ORIGIN: `http://127.0.0.1:${apiPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const keep = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-4000) }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`vite exited\n${log}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) return child
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  child.kill('SIGKILL')
  throw new Error(`vite did not start\n${log}`)
}

async function clockLine(page: Page): Promise<{ lines: number; nowrap: boolean; tabular: boolean }> {
  return page.locator('.ui-clock-value').evaluate((el) => {
    const style = getComputedStyle(el)
    const range = document.createRange()
    range.selectNodeContents(el)
    return {
      lines: range.getClientRects().length,
      nowrap: style.whiteSpace === 'nowrap',
      tabular: style.fontVariantNumeric.includes('tabular-nums'),
    }
  })
}

async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze()
  return result.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`)
}

async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, a, input, select, textarea')]
    const found: string[] = []
    for (const el of nodes) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.width < 44 || rect.height < 44) {
        const name = el.getAttribute('data-testid') || el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 40) || el.tagName
        found.push(`${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`)
      }
    }
    return found
  })
}
