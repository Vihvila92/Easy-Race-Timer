// SPDX-License-Identifier: AGPL-3.0-only
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

export async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze()
  return result.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`)
}

/** Interactive boxes under 44×44 px. Hidden elements (no box) are skipped. */
export async function smallTargets(page: Page): Promise<string[]> {
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
