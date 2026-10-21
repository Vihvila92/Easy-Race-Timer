import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { killServer, startServer, type RunningServer } from './server.ts'

const fiMessage = 'Ajanotto-ohjelmaan ei saada yhteyttä. Paina Yritä uudelleen. Jos se ei auta, sulje ohjelma ja avaa se uudelleen. Jos ongelma jatkuu, ota yhteys seuran tekniseen tukeen.'
const enMessage = 'The timing program cannot be reached. Press Try again. If that does not help, close the program and open it again. If the problem continues, contact the club\'s technical support.'

test.describe('unreachable race program', () => {
  let server: RunningServer
  let origin: string

  test.beforeAll(async () => {
    server = await startServer(8098, path.join(mkdtempSync(path.join(tmpdir(), 'ert-unreachable-')), 'ert.sqlite'))
    origin = `http://127.0.0.1:${server.port}`
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('shows a translated error, a 44 px retry control, and no axe violations', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await page.route('**/api/**', (route) => route.abort('failed'))
    await page.addInitScript(() => localStorage.setItem('ert-theme', 'light'))
    await page.goto(origin)
    await expect(page.getByTestId('unreachable-message')).toHaveText(fiMessage)
    await expect(page.getByRole('button', { name: 'Yritä uudelleen' })).toBeVisible()
    await expect(page.getByTestId('wizard')).toHaveCount(0)
    const lightSize = await buttonSize(page)
    expect(lightSize.width, 'light width').toBeGreaterThanOrEqual(44)
    expect(lightSize.height, 'light height').toBeGreaterThanOrEqual(44)
    expect(await violations(page), 'light').toEqual([])
    expect(await smallTargets(page), 'light targets').toEqual([])

    await page.setViewportSize({ width: 375, height: 800 })
    const narrowSize = await buttonSize(page)
    expect(narrowSize.width, '375 width').toBeGreaterThanOrEqual(44)
    expect(narrowSize.height, '375 height').toBeGreaterThanOrEqual(44)
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)

    await page.evaluate(() => localStorage.setItem('ert-theme', 'dark'))
    await page.reload()
    await expect(page.getByTestId('unreachable-message')).toHaveText(fiMessage)
    expect(await violations(page), 'dark').toEqual([])

    await page.evaluate(() => localStorage.setItem('ert-locale', 'en'))
    await page.reload()
    await expect(page.getByTestId('unreachable-message')).toHaveText(enMessage)
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('shows the same view for HTML and for JSON without a ties array', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    const bodies = [
      { contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body>not the program</body></html>' },
      { contentType: 'application/json', body: JSON.stringify({ ok: true, races: [] }) },
      { contentType: 'application/json', body: JSON.stringify({ ties: { status: 'unconfirmed' } }) },
    ]
    for (const item of bodies) {
      await page.unroute('**/api/**').catch(() => undefined)
      await page.route('**/api/**', (route) => route.fulfill({
        status: 200,
        contentType: item.contentType,
        body: item.body,
      }))
      await page.goto(`${origin}/`)
      await expect(page.getByTestId('unreachable-message')).toHaveText(fiMessage)
      await expect(page.getByRole('button', { name: 'Yritä uudelleen' })).toBeVisible()
    }
    expect(pageErrors).toEqual([])
  })

  test('a bootstrap that never answers shows Try again', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/bootstrap', async (route) => {
      await held
      await route.abort('timedout').catch(() => undefined)
    })
    await page.goto(origin)
    await expect(page.getByText('Ladataan')).toBeVisible()
    await expect(page.getByTestId('unreachable-message')).toHaveText(fiMessage, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Yritä uudelleen' })).toBeVisible()
    await expect(page.getByTestId('wizard')).toHaveCount(0)
    release()
    expect(pageErrors).toEqual([])
  })

  test('Try again opens the wizard once the program answers', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    let reachable = false
    await page.route('**/api/**', (route) => {
      if (!reachable) return route.abort('failed')
      return route.continue()
    })
    await page.goto(origin)
    await expect(page.getByTestId('unreachable-message')).toHaveText(fiMessage)
    reachable = true
    await page.getByTestId('unreachable-retry').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('wizard')).toBeVisible()
    await expect(page.getByTestId('unreachable')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })
})

function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function buttonSize(page: Page): Promise<{ width: number; height: number }> {
  const box = await page.getByTestId('unreachable-retry').boundingBox()
  return { width: box?.width ?? 0, height: box?.height ?? 0 }
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
