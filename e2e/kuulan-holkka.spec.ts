import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseCsv, RESULT_FIELDS } from '../packages/core/src/index.ts'
import { killServer, startServer, type RunningServer } from './server.ts'

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

async function open(page: Page, name: string) {
  await page.getByTestId(`nav-${name}`).click()
}

async function noError(page: Page) {
  await expect(page.getByTestId('form-error')).toHaveCount(0)
}

test.describe('Kuulan hölkkä', () => {
  let server: RunningServer
  const port = 8099

  test.beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(tmpdir(), 'ert-')), 'ert.sqlite')
    server = await startServer(port, dbFile)
  })

  test.afterAll(async () => {
    if (server) await killServer(server)
  })

  test('prepares, times and locks the race through the UI', async ({ page, request }) => {
    test.setTimeout(240_000)
    await page.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort())
    await page.goto('/')
    await page.evaluate(() => sessionStorage.setItem('ert-next-tap', '1'))
    await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true)

    await open(page, 'import')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/events/import') && response.ok()),
      page.getByTestId('event-file').setInputFiles(path.join(dir, 'event.json')),
    ])
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

    await open(page, 'import')
    await page.getByTestId('age-basis-birth_year').click()
    await expect(page.getByTestId('suggestions')).toHaveAttribute('data-basis', 'birth_year')
    await expect(page.getByTestId('suggestion-123-category')).toHaveText('P8')
    await expect(page.getByTestId('suggestion-135-category')).toHaveText('')
    await page.getByTestId('age-basis-birth_date').click()
    await expect(page.getByTestId('suggestion-123-category')).toHaveText('P6')

    for (const action of raceDay.actions) {
      if (action.at) await setClock(page, request, action.at)
      await runAction(page, action)
      if (action.type === 'finish_tap' && action.tap_id === 'F030') {
        const before = await request.get('/api/v1/timing-events')
        const taps = (await before.json() as { id: string }[]).filter((event) => String(event.id).startsWith('F'))
        expect(taps.map((event) => event.id)).toContain('F030')
        await killServer(server)
        server = await startServer(port, server.dbFile)
        await page.reload()
        await expect(page.getByTestId('nav-finish')).toBeVisible()
        const after = await request.get('/api/v1/timing-events')
        const kept = (await after.json() as { id: string }[]).filter((event) => String(event.id).startsWith('F'))
        expect(kept.map((event) => event.id)).toContain('F030')
      }
      if (action.type === 'merge_clubs') {
        await page.getByTestId('club-new-abbr').fill('UU')
        await page.getByTestId('club-new-name').fill('Toinen UU')
        await page.getByTestId('club-new-save').click()
        await expect(page.getByTestId('form-error')).toContainText('CLUB_ABBREVIATION_TAKEN')
      }
    }

    await open(page, 'audit')
    for (const action of raceDay.actions) {
      if (typeof action.reason === 'string' && action.type !== 'change_race_rejected') {
        await expect(page.getByTestId('audit-log')).toContainText(action.reason)
      }
    }
    await expect(page.locator('[data-testid="audit-row"][data-action="confirm_tie"]')).toHaveCount(3)
    await expect(page.locator('[data-testid="audit-row"][data-action="lock"]')).toHaveCount(2)

    const ranked = await request.get('/api/v1/results?format=csv')
    expect(project(await ranked.text())).toEqual(project(read('expected-results.csv')))
    await open(page, 'results')
    await page.getByTestId('offset-unranked').click()
    await expect(page.getByTestId('form-error')).toHaveCount(0)
    const unranked = await request.get('/api/v1/results?format=csv')
    expect(project(await unranked.text())).toEqual(project(read('expected-results.offset-unranked.csv')))
    await page.getByTestId('offset-open_category').click()
    await expect(page.getByTestId('form-error')).toHaveCount(0)
    const openCategory = await request.get('/api/v1/results?format=csv')
    expect(project(await openCategory.text())).toEqual(project(read('expected-results.offset-open-category.csv')))
    await page.getByTestId('offset-ranked').click()
    await noError(page)

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

    await open(page, 'clubs')
    const unmerge = page.waitForResponse((response) => response.url().includes('/clubs/CL_UU_DUP/unmerge') && response.ok())
    await page.getByTestId('unmerge-CL_UU_DUP').click()
    await unmerge
    await expect(page.getByTestId('club-entries-CL_UU_DUP')).toHaveText('2')
    await page.getByTestId('merge-reason-CL_UU_DUP').fill('Yhdistä uudelleen')
    await page.getByTestId('merge-CL_UU_DUP').click()
    await expect(page.getByTestId('club-entries-CL_UU_DUP')).toHaveText('0')

    await setClock(page, request, '2028-06-13T12:00:00+03:00')
    await open(page, 'office')
    await page.getByTestId('retention-run').click()
    await noError(page)
    const anonymized = await request.get('/api/v1/results?format=csv')
    expect(project(await anonymized.text())).toEqual(project(read('expected-results.anonymized.csv')))

    await open(page, 'finish')
    const finishAxe = await new AxeBuilder({ page }).analyze()
    expect(finishAxe.violations).toEqual([])
    await open(page, 'results')
    const resultsAxe = await new AxeBuilder({ page }).analyze()
    expect(resultsAxe.violations).toEqual([])
  })
})

async function runAction(page: Page, action: Record<string, any>) {
  if (action.type === 'confirm_club_suggestion') {
    await open(page, 'import')
    const row = page.locator(`[data-testid="club-match"][data-name="${action.raw}"]`)
    await row.getByTestId('club-reason').fill(action.reason)
    await row.getByTestId('club-confirm').click()
    await noError(page)
    return
  }
  if (action.type === 'create_club') {
    await open(page, 'import')
    const row = page.locator(`[data-testid="club-match"][data-name="${action.raw}"]`)
    await row.getByTestId('club-city').fill(action.municipality)
    await row.getByTestId('club-create').click()
    await noError(page)
    return
  }
  if (action.type === 'resolve_abbreviation_conflict') {
    await open(page, 'import')
    const row = page.locator(`[data-testid="club-match"][data-name="${action.raw}"]`)
    await row.getByTestId('club-reason').fill(action.reason)
    await row.getByTestId('club-same').click()
    await noError(page)
    return
  }
  if (action.type === 'merge_clubs') {
    await open(page, 'clubs')
    await page.getByTestId(`merge-reason-${action.source}`).fill(action.reason)
    await page.getByTestId(`merge-${action.source}`).click()
    await noError(page)
    return
  }
  if (action.type === 'register_late') {
    await open(page, 'entries')
    const person = action.person
    await page.getByTestId('late-first').fill(person.first_name)
    await page.getByTestId('late-last').fill(person.last_name)
    await page.getByTestId('late-gender').selectOption(person.gender)
    await page.getByTestId('late-birth').fill(person.birth_date)
    await page.getByTestId('late-email').fill(person.email ?? '')
    await page.getByTestId('late-club').fill(action.club_query ?? '')
    await expect(page.getByTestId('late-club-hit')).toHaveText(String(action.expect_club ?? ''))
    await page.getByTestId('late-race').fill(action.race)
    await page.getByTestId('late-bib').fill(String(action.bib))
    if (action.consent_long_term === 'kyllä') await page.getByTestId('late-consent').check()
    else await page.getByTestId('late-consent').uncheck()
    await page.getByTestId('late-save').click()
    await noError(page)
    return
  }
  if (action.type === 'change_bib') {
    await open(page, 'entries')
    await page.getByTestId('bib-from').fill(String(action.bib_from))
    await page.getByTestId('bib-to').fill(String(action.bib_to))
    await page.getByTestId('bib-reason').fill(action.reason)
    await page.getByTestId('bib-save').click()
    await noError(page)
    return
  }
  if (action.type === 'set_status') {
    await open(page, 'entries')
    await page.getByTestId('status-bib').fill(String(action.bib))
    await page.getByTestId('status-value').selectOption(action.status)
    await page.getByTestId('status-reason').fill(action.reason)
    await page.getByTestId('status-save').click()
    await noError(page)
    return
  }
  if (action.type === 'set_start_offset') {
    await open(page, 'entries')
    await page.getByTestId('offset-bib').fill(String(action.bib))
    await page.getByTestId('offset-ms').fill(String(action.offset_ms))
    await page.getByTestId('offset-reason').fill(action.reason)
    await page.getByTestId('offset-save').click()
    await noError(page)
    return
  }
  if (action.type === 'change_race_rejected') {
    await open(page, 'entries')
    await page.getByTestId('race-bib').fill(String(action.bib))
    await page.getByTestId('race-id').fill(action.race)
    await page.getByTestId('race-bib-to').fill('')
    await page.getByTestId('race-reason').fill('yritys')
    await page.getByTestId('race-save').click()
    await expect(page.getByTestId('form-error')).toContainText(action.expect_error)
    return
  }
  if (action.type === 'change_race') {
    await open(page, 'entries')
    await page.getByTestId('race-bib').fill(String(action.bib))
    await page.getByTestId('race-id').fill(action.race)
    await page.getByTestId('race-bib-to').fill(String(action.bib_to))
    await page.getByTestId('race-reason').fill(action.reason)
    await page.getByTestId('race-save').click()
    await noError(page)
    return
  }
  if (action.type === 'start') {
    await open(page, 'start')
    await page.getByTestId(`start-${action.race}`).click()
    await noError(page)
    return
  }
  if (action.type === 'finish_tap') {
    await open(page, 'finish')
    await page.getByTestId(action.mode === 'bib_first' ? 'finish-mode-bib' : 'finish-mode-time').click()
    await page.getByTestId('finish-bib').fill(action.bib == null ? '' : String(action.bib))
    await page.getByTestId('finish-tap').click()
    await expect(page.getByTestId(`finish-row-${action.tap_id}`)).toHaveAttribute('data-sync', 'ok')
    return
  }
  if (action.type === 'copy_time' || action.type === 'assign_bib' || action.type === 'void') {
    await open(page, 'corrections')
    await page.getByTestId('corr-tap').fill(action.tap_id ?? action.source_tap_id)
    await page.getByTestId('corr-bib').fill(action.bib == null ? '' : String(action.bib))
    await page.getByTestId('corr-reason').fill(action.reason)
    const button = action.type === 'copy_time' ? 'corr-copy' : action.type === 'void' ? 'corr-void' : 'corr-assign'
    await page.getByTestId(button).click()
    await noError(page)
    return
  }
  if (action.type === 'check_lock_blocked') {
    await open(page, 'results')
    await page.getByTestId(`lock-${action.race}`).click()
    const items = page.getByTestId(`blockers-${action.race}`).getByTestId('blocker')
    await expect(items).toHaveText(action.expect_blockers)
    return
  }
  if (action.type === 'confirm_tie_order') {
    await open(page, 'ties')
    const card = page.getByTestId(`tie-${action.race}-${action.display_time}`)
    const order = action.order as number[][]
    if (order.length === 1) {
      await card.getByTestId('tie-equal').click()
    } else if (action.display_time === '22:13') {
      await card.getByTestId('tie-member-130').dragTo(card.getByTestId('tie-member-129'))
      const ids = await card.locator('[data-testid^="tie-member-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
      if (ids[0] !== 'tie-member-130') await card.getByTestId('tie-up-130').click()
    }
    if (action.display_time === '21:32') {
      await card.getByTestId('tie-basis-finish_judge').focus()
      await page.keyboard.press('Enter')
      await card.getByTestId('tie-reason').focus()
      await page.keyboard.insertText(action.reason)
      await card.getByTestId('tie-confirm').focus()
      await page.keyboard.press('Enter')
    } else {
      await card.getByTestId('tie-basis-finish_judge').click()
      await card.getByTestId('tie-reason').fill(action.reason)
      await card.getByTestId('tie-confirm').click()
    }
    await expect(card).toHaveAttribute('data-status', 'confirmed')
    return
  }
  if (action.type === 'lock') {
    await open(page, 'results')
    await page.getByTestId(`lock-${action.race}`).click()
    await noError(page)
    return
  }
  if (action.type === 'edit_after_lock_rejected') {
    await open(page, 'entries')
    await page.getByTestId('status-bib').fill('201')
    await page.getByTestId('status-value').selectOption('dns')
    await page.getByTestId('status-reason').fill('ei pitäisi onnistua')
    await page.getByTestId('status-save').click()
    await expect(page.getByTestId('form-error')).toContainText('EVENT_LOCKED')
  }
}
