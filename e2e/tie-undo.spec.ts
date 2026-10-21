// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

test.describe('tie undo', () => {
  let server: RunningServer

  test.beforeAll(async () => {
    server = await startServer(8099, path.join(mkdtempSync(path.join(tmpdir(), 'ert-tie-')), 'ert.sqlite'))
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('keyboard reorder, confirm, and undo', async ({ page, request }) => {
    await authorize(request)
    const date = '2027-06-12T11:00:00.000+03:00'
    await request.post('/api/v1/events/import', {
      data: {
        id: 'EV_TIE',
        name: 'Tasatesti',
        date: '2027-06-12',
        timezone: 'Europe/Helsinki',
        sport: 'run',
        races: [{ id: 'R1', name: { fi: '1 km', en: '1 km' }, distance_m: 1000, start_mode: 'mass', scheduled_start: date }],
        categories: [{ id: 'M', race_id: 'R1', gender: 'M', min_age: 16, max_age: null, ranked: true, name: { fi: 'M', en: 'M' }, description: { fi: 'M', en: 'M' } }],
      },
    })
    for (const [bib, name] of [[1, 'Aalto'], [2, 'Niemi']] as const) {
      await request.post('/api/v1/entries/late', {
        data: { firstName: name, lastName: 'Test', gender: 'M', birthDate: '1990-01-01', raceId: 'R1', bib, consent: false },
      })
    }
    const start = Date.parse(date)
    await request.post('/api/v1/races/R1/start', { data: { timeMs: start } })
    await request.post('/api/v1/timing-events', { data: { id: 'T1', timeMs: start + 10_000, bib: 1, mode: 'time_first' } })
    await request.post('/api/v1/timing-events', { data: { id: 'T2', timeMs: start + 10_400, bib: 2, mode: 'time_first' } })

    await page.goto('/#/ties')
    const card = page.getByTestId('tie-R1-0:10')
    await card.getByTestId('tie-up-2').focus()
    await page.keyboard.press('Enter')
    await card.getByTestId('tie-basis-finish_judge').click()
    await card.getByTestId('tie-reason').fill('Näppäimistö')
    await card.getByTestId('tie-confirm').click()
    await expect(card).toHaveAttribute('data-status', 'confirmed')
    await page.getByTestId('tie-undo').click()
    await expect(card).toHaveAttribute('data-status', 'unconfirmed')
  })
})
