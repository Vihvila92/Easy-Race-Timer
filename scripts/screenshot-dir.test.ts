// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const e2e = path.resolve(import.meta.dirname, '../e2e')

describe('e2e screenshot directory', () => {
  it('reads ERT_SCREENSHOT_DIR and defaults to test-results/screenshots', () => {
    const source = readFileSync(path.join(e2e, 'screenshot-dir.ts'), 'utf8')
    expect(source).toContain('ERT_SCREENSHOT_DIR')
    expect(source).toContain("path.join('test-results', 'screenshots')")
  })

  it('has no hardcoded absolute filesystem paths', () => {
    const files = readdirSync(e2e).filter((name) => name.endsWith('.ts'))
    const absolute = /['"`](?:\/opt\/|\/Users\/|\/home\/|\/tmp\/|\/var\/|[A-Za-z]:\\)/
    for (const name of files) {
      const text = readFileSync(path.join(e2e, name), 'utf8')
      expect(text, name).not.toMatch(absolute)
    }
  })
})
