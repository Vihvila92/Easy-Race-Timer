// SPDX-License-Identifier: AGPL-3.0-only
import { test as base, expect } from '@playwright/test'

/** Fail the test when the browser reports a Content-Security-Policy violation. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const violations: string[] = []
    page.on('console', (message) => {
      const text = message.text()
      if (/content security policy/i.test(text)) violations.push(text)
    })
    await use(page)
    expect(violations, violations.join('\n')).toEqual([])
  },
})

export { expect }
