import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from './fixtures.ts'
import { killServer, startServer, type RunningServer } from './server.ts'

test.describe('desktop UI content security policy', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8096, path.join(mkdtempSync(path.join(tmpdir(), 'ert-csp-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('loads the race wizard with no Content-Security-Policy console error', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${server.port}/`)
    await expect(page.getByTestId('wizard')).toBeVisible()
  })
})