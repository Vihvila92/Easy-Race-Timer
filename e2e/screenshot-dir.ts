import { mkdirSync } from 'node:fs'
import path from 'node:path'

/** Directory for e2e screenshots. Override with ERT_SCREENSHOT_DIR. */
export function screenshotDir(): string {
  const dir = process.env.ERT_SCREENSHOT_DIR || path.join('test-results', 'screenshots')
  mkdirSync(dir, { recursive: true })
  return dir
}
