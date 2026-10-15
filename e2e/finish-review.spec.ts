import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

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
    await authorize(request)
    expect((await request.post('/api/v1/events/import', {
      data: {
        id: 'EV_FINISH',
        name: 'Maali',
        date: '2027-06-12',
        timezone: 'Europe/Helsinki',
        sport: 'run',
        races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass' }],
        categories: [{ id: 'M', race_id: 'R1', name: { fi: 'M', en: 'M' }, gender: 'M', min_age: 0 }],
      },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/entries/late', {
      data: { firstName: 'Aino', lastName: 'Testi', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib: 105, consent: false },
    })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/races/R1/start', { data: { timeMs: Date.now() - 1000 } })).ok()).toBeTruthy()

    await page.goto('/')
    await page.getByTestId('nav-finish').click()
    await expect(page.getByTestId('finish-hint')).toHaveText('Paina plus-näppäintä (kannettavalla F12) maaliintulon kohdalla.')
    await page.getByTestId('guidance-expert').click()
    await expect(page.getByTestId('finish-hint')).toHaveCount(0)
    await page.getByTestId('guidance-guided').click()
    await expect(page.getByTestId('finish-hint')).toBeVisible()
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
