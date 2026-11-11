// SPDX-License-Identifier: AGPL-3.0-only
import { test as base, expect } from '@playwright/test'
import { apiOrigin } from './server.ts'

/** Fail the test when the browser reports a Content-Security-Policy violation. */
export const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const origin = apiOrigin() || baseURL
    const request = await playwright.request.newContext(origin ? { baseURL: origin } : {})
    await use(request)
    await request.dispose()
  },
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
