// SPDX-License-Identifier: AGPL-3.0-only
import { type APIRequestContext, type Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import AxeBuilder from '@axe-core/playwright'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseCsv, RESULT_FIELDS } from '../packages/core/src/index.ts'
import { noError, open, runAction } from './kuulan-actions.ts'
import { authorize, killServer, startServer, type RunningServer } from './server.ts'

const dir = path.resolve('testdata/kuulan-holkka')
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8')
const raceDay = JSON.parse(read('race-day.json')) as { actions: Record<string, any>[] }

function project(csv: string) {
  return parseCsv(csv).map((row) => RESULT_FIELDS.map((field) => row[field] ?? '').join(';'))
}

async function setClock(page: Page, request: APIRequestContext, at: string) {
  const response = await request.post('/api/v1/test/clock', { data: { at } })
  expect(response.ok()).toBeTruthy()
  await page.evaluate((value) => sessionStorage.setItem('ert-test-clock', value), at)
}

/** The results view posts the policy without awaiting it, so the CSV read waits for that response. */
async function expectOffsetPolicy(page: Page, request: APIRequestContext, testId: string, expected?: string) {
  const posted = page.waitForResponse((response) => {
    return response.url().includes('/api/v1/settings/offset-policy') && response.request().method() === 'POST'
  })
  await page.getByTestId(testId).click()
  expect((await posted).ok()).toBeTruthy()
  await noError(page)
  if (!expected) return
  const csv = await request.get('/api/v1/results?format=csv')
  expect(project(await csv.text())).toEqual(project(read(expected)))
}

async function startKuulan(page: Page, request: APIRequestContext) {
  await page.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort())
  await page.goto('/')
  await page.evaluate(() => sessionStorage.setItem('ert-next-tap', '1'))
  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true)
  await expect(page.getByTestId('nav-import')).toBeVisible()
  await authorize(request)
}

async function importKuulan(page: Page, request: APIRequestContext) {
  await open(page, 'import')
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/events/import') && response.ok()),
    page.getByTestId('event-file').setInputFiles(path.join(dir, 'event.json')),
  ])
  expect((await request.post('/api/v1/settings/pin', { data: { pin: '2468' } })).ok()).toBeTruthy()
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/clubs/import') && response.ok()),
    page.getByTestId('clubs-file').setInputFiles(path.join(dir, 'clubs-registry.json')),
  ])
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/entries/import/preview') && response.ok()),
    page.getByTestId('csv-file').setInputFiles(path.join(dir, 'entries.csv')),
  ])
  await expect(page.getByTestId('import-summary')).toContainText('67')
  await expect(page.getByTestId('import-summary')).toContainText('0')
}

async function expectImportPreview(page: Page) {
  const importedBibs = new Set(parseCsv(read('entries.csv')).map((row) => row.numero))
  const categories = parseCsv(read('expected-categories.csv')).filter((row) => importedBibs.has(row.numero))
  expect(categories).toHaveLength(67)
  for (const row of categories) {
    await expect(page.getByTestId(`preview-${row.numero}-birth_date`)).toHaveText(row.birth_date_sarja)
    await expect(page.getByTestId(`preview-${row.numero}-birth_date-warn`)).toHaveText(row.birth_date_varoitukset)
    await expect(page.getByTestId(`preview-${row.numero}-birth_year`)).toHaveText(row.birth_year_sarja)
    await expect(page.getByTestId(`preview-${row.numero}-birth_year-warn`)).toHaveText(row.birth_year_varoitukset)
  }
  for (const club of parseCsv(read('expected-clubs.csv'))) {
    const match = page.locator(`[data-testid="club-match"][data-name="${club.seura}"][data-abbr="${club.seuran_lyhenne}"]`)
    await expect(match).toHaveAttribute('data-type', club.tunnistus)
  }
  await page.getByTestId('import-commit').click()
  await open(page, 'office')
  await expect(page.getByTestId('consent-count')).toHaveText('67')
}

async function expectAgeBasis(page: Page) {
  await open(page, 'import')
  await page.getByTestId('age-basis-birth_year').click()
  await expect(page.getByTestId('suggestions')).toHaveAttribute('data-basis', 'birth_year')
  await expect(page.getByTestId('suggestion-123-category')).toHaveText('P8')
  await expect(page.getByTestId('suggestion-135-category')).toHaveText('')
  await page.getByTestId('age-basis-birth_date').click()
  // The race file keeps the birth year only, so a later suggestion uses that year.
  // The category stored at import still used the full date from the CSV.
  await expect(page.getByTestId('suggestion-123-category')).toHaveText('P8')
}

async function runRaceDay(page: Page, request: APIRequestContext, running: { server?: RunningServer }, port: number) {
  for (const action of raceDay.actions) {
    if (action.at) await setClock(page, request, action.at)
    await runAction(page, action)
    if (action.type === 'finish_tap' && action.tap_id === 'F030') await restartDuringFinish(page, request, running, port)
    if (action.type === 'merge_clubs') await rejectDuplicateAbbreviation(page)
  }
}

async function restartDuringFinish(page: Page, request: APIRequestContext, running: { server?: RunningServer }, port: number) {
  const before = await request.get('/api/v1/timing-events')
  const taps = await before.json() as { id: string; label?: string }[]
  expect(taps.some((event) => event.label === 'F030' || event.id === 'F030')).toBe(true)
  const current = running.server
  if (!current) throw new Error('server is not running')
  await killServer(current)
  running.server = await startServer(port, current.dbFile)
  await page.reload()
  await expect(page.getByTestId('nav-finish')).toBeVisible()
  const after = await request.get('/api/v1/timing-events')
  const kept = await after.json() as { id: string; label?: string }[]
  expect(kept.some((event) => event.label === 'F030' || event.id === 'F030')).toBe(true)
}

async function rejectDuplicateAbbreviation(page: Page) {
  await page.getByTestId('club-new-abbr').fill('UU')
  await page.getByTestId('club-new-name').fill('Toinen UU')
  await page.getByTestId('club-new-save').click()
  await expect(page.getByTestId('form-error')).toContainText('CLUB_ABBREVIATION_TAKEN')
}

async function expectAudit(page: Page) {
  await open(page, 'audit')
  for (const action of raceDay.actions) {
    if (typeof action.reason === 'string' && action.type !== 'change_race_rejected') {
      await expect(page.getByTestId('audit-log')).toContainText(action.reason)
    }
  }
  await expect(page.locator('[data-testid="audit-row"][data-action="confirm_tie"]')).toHaveCount(3)
  await expect(page.locator('[data-testid="audit-row"][data-action="lock"]')).toHaveCount(2)
}

async function expectRankedResults(page: Page, request: APIRequestContext) {
  const ranked = await request.get('/api/v1/results?format=csv')
  expect(project(await ranked.text())).toEqual(project(read('expected-results.csv')))
  await open(page, 'results')
  await expectOffsetPolicy(page, request, 'offset-unranked', 'expected-results.offset-unranked.csv')
  await expectOffsetPolicy(page, request, 'offset-open_category', 'expected-results.offset-open-category.csv')
  await expectOffsetPolicy(page, request, 'offset-ranked')
}

async function expectPrint(page: Page) {
  await open(page, 'print')
  const frame = page.frameLocator('[data-testid=print-frame]')
  await expect(frame.locator('h2')).toHaveCount(16)
  await expect(frame.locator('body')).not.toContainText('Kunto 8 km')
  await expect(frame.locator('body')).toContainText('Mäkinen')
  await page.getByTestId('lang-en').click()
  await expect(frame.locator('body')).toContainText('Place')
  await expect(frame.locator('body')).toContainText('G4')
  await expect(frame.locator('body')).toContainText('W')
  await page.getByTestId('lang-fi').click()
}

async function expectNarrowResults(page: Page) {
  await page.setViewportSize({ width: 375, height: 800 })
  await open(page, 'results')
  await page.getByTestId('results-race').selectOption('R4')
  await page.getByTestId('results-filter').fill('UU')
  await expect(page.getByTestId('results-count')).toHaveText('13')
  await expect(page.locator('.club-abbr').first()).toBeVisible()
  await expect(page.locator('.club-full').first()).toBeHidden()
  await page.getByTestId('results-race').selectOption('R8')
  await expect(page.getByTestId('results-count')).toHaveText('10')
  await page.setViewportSize({ width: 1280, height: 800 })
}

async function remergeDuplicateClub(page: Page) {
  await open(page, 'clubs')
  const unmerge = page.waitForResponse((response) => response.url().includes('/clubs/CL_UU_DUP/unmerge') && response.ok())
  await page.getByTestId('unmerge-CL_UU_DUP').click()
  await unmerge
  await expect(page.getByTestId('club-entries-CL_UU_DUP')).toHaveText('2')
  await page.getByTestId('merge-reason-CL_UU_DUP').fill('Yhdistä uudelleen')
  await page.getByTestId('merge-CL_UU_DUP').click()
  await expect(page.getByTestId('club-entries-CL_UU_DUP')).toHaveText('0')
}

async function expectRetention(page: Page, request: APIRequestContext) {
  await setClock(page, request, '2028-06-13T12:00:00+03:00')
  await open(page, 'office')
  const retention = page.waitForResponse((response) => response.url().includes('/api/v1/retention/run'))
  await page.getByTestId('retention-run').click()
  expect((await retention).ok()).toBeTruthy()
  await noError(page)
  const anonymized = await request.get('/api/v1/results?format=csv')
  expect(project(await anonymized.text())).toEqual(project(read('expected-results.anonymized.csv')))
}

async function expectAxe(page: Page) {
  await open(page, 'finish')
  const finishAxe = await new AxeBuilder({ page }).analyze()
  expect(finishAxe.violations).toEqual([])
  await open(page, 'results')
  const resultsAxe = await new AxeBuilder({ page }).analyze()
  expect(resultsAxe.violations).toEqual([])
}

test.describe('Kuulan hölkkä', () => {
  const port = 8099
  const running: { server?: RunningServer } = {}

  test.beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(tmpdir(), 'ert-')), 'ert.sqlite')
    running.server = await startServer(port, dbFile)
  })

  test.afterAll(async () => {
    if (running.server) await killServer(running.server)
  })

  test('prepares, times and locks the race through the UI', async ({ page, request }) => {
    test.setTimeout(240_000)
    await startKuulan(page, request)
    await importKuulan(page, request)
    await expectImportPreview(page)
    await expectAgeBasis(page)
    await runRaceDay(page, request, running, port)
    await expectAudit(page)
    await expectRankedResults(page, request)
    await expectPrint(page)
    await expectNarrowResults(page)
    await remergeDuplicateClub(page)
    await expectRetention(page, request)
    await expectAxe(page)
  })
})
