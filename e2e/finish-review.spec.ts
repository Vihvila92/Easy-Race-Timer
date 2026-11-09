// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from './fixtures.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { killServer, seedMassStart, startServer, type RunningServer } from './server.ts'

const duplicate = 'Numero 105 on jo kirjattu – merkitty tarkistettavaksi'
const unknown = 'Numeroa 9999 ei löydy – merkitty tarkistettavaksi'

test.describe('finish review warnings', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8099, path.join(mkdtempSync(path.join(tmpdir(), 'ert-finish-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('warns on a duplicate bib and an unknown bib and keeps both for review', async ({ page, request }) => {
    await seedMassStart(request, { id: 'EV_FINISH', name: 'Maali', bibs: [105], startAgoMs: 1_000 })

    await page.goto('/')
    await page.getByTestId('nav-finish').click()
    await expect(page.getByTestId('finish-hint')).toHaveCount(0)
    await page.getByTestId('finish-bib').fill('105')
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId('finish-recorded')).toContainText('Aika kirjattu')

    await page.getByTestId('finish-bib').fill('105')
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId('finish-recorded')).toContainText(duplicate)
    await expect(page.getByTestId('finish-review')).toContainText(duplicate)

    await page.getByTestId('finish-bib').fill('9999')
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId('finish-recorded')).toContainText(unknown)
    await expect(page.getByTestId('finish-review')).toContainText(duplicate)
    await expect(page.getByTestId('finish-review')).toContainText(unknown)
    await expect(page.getByTestId('finish-review').locator('li')).toHaveCount(2)
    await expect(page.getByTestId('finish-log').locator('li')).toHaveCount(3)
  })
})
