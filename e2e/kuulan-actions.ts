// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page } from '@playwright/test'

const blockerLabels: Record<string, string> = {
  'entry:108:no_result': 'Numerolla 108 ei ole tulosta',
  'tie:R4:21:32': 'Ratkaisematon tasatilanne, R4, 21:32',
  'tie:R4:22:13': 'Ratkaisematon tasatilanne, R4, 22:13',
  'tie:R8:41:07': 'Ratkaisematon tasatilanne, R8, 41:07',
}

function blockerText(id: string): string {
  const text = blockerLabels[id]
  if (!text) throw new Error(`missing blocker label for ${id}`)
  if (text === id) throw new Error(`blocker label still raw: ${id}`)
  return text
}

export async function open(page: Page, name: string) {
  await page.getByTestId(`nav-${name}`).click()
}

export async function noError(page: Page) {
  await expect(page.getByTestId('form-error')).toHaveCount(0)
}

type RaceAction = Record<string, any>

function clubRow(page: Page, raw: string) {
  return page.locator(`[data-testid="club-match"][data-name="${raw}"]`)
}

async function confirmClubSuggestion(page: Page, action: RaceAction) {
  await open(page, 'import')
  const row = clubRow(page, action.raw)
  await row.getByTestId('club-reason').fill(action.reason)
  await row.getByTestId('club-confirm').click()
  await noError(page)
}

async function createClub(page: Page, action: RaceAction) {
  await open(page, 'import')
  const row = clubRow(page, action.raw)
  await row.getByTestId('club-city').fill(action.municipality)
  await row.getByTestId('club-create').click()
  await noError(page)
}

async function resolveAbbreviationConflict(page: Page, action: RaceAction) {
  await open(page, 'import')
  const row = clubRow(page, action.raw)
  await row.getByTestId('club-reason').fill(action.reason)
  await row.getByTestId('club-same').click()
  await noError(page)
}

async function mergeClubs(page: Page, action: RaceAction) {
  await open(page, 'clubs')
  await page.getByTestId(`merge-reason-${action.source}`).fill(action.reason)
  await page.getByTestId(`merge-${action.source}`).click()
  await noError(page)
}

async function registerLate(page: Page, action: RaceAction) {
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
}

async function changeBib(page: Page, action: RaceAction) {
  await open(page, 'entries')
  await page.getByTestId('bib-from').fill(String(action.bib_from))
  await page.getByTestId('bib-to').fill(String(action.bib_to))
  await page.getByTestId('bib-reason').fill(action.reason)
  await page.getByTestId('bib-save').click()
  await noError(page)
}

async function setStatus(page: Page, action: RaceAction) {
  await open(page, 'entries')
  await page.getByTestId('status-bib').fill(String(action.bib))
  await page.getByTestId('status-value').selectOption(action.status)
  await page.getByTestId('status-reason').fill(action.reason)
  await page.getByTestId('status-save').click()
  await noError(page)
}

async function setStartOffset(page: Page, action: RaceAction) {
  await open(page, 'entries')
  await page.getByTestId('offset-bib').fill(String(action.bib))
  await page.getByTestId('offset-ms').fill(String(action.offset_ms))
  await page.getByTestId('offset-reason').fill(action.reason)
  await page.getByTestId('offset-save').click()
  await noError(page)
}

async function saveRaceChange(page: Page, action: RaceAction, bibTo: string, reason: string) {
  await open(page, 'entries')
  await page.getByTestId('race-bib').fill(String(action.bib))
  await page.getByTestId('race-id').fill(action.race)
  await page.getByTestId('race-bib-to').fill(bibTo)
  await page.getByTestId('race-reason').fill(reason)
  await page.getByTestId('race-save').click()
}

async function changeRaceRejected(page: Page, action: RaceAction) {
  await saveRaceChange(page, action, '', 'yritys')
  await expect(page.getByTestId('form-error')).toContainText(action.expect_error)
}

async function changeRace(page: Page, action: RaceAction) {
  await saveRaceChange(page, action, String(action.bib_to), action.reason)
  await noError(page)
}

async function startRace(page: Page, action: RaceAction) {
  await open(page, 'start')
  await page.getByTestId(`start-${action.race}`).click()
  await noError(page)
}

async function finishTap(page: Page, action: RaceAction) {
  await open(page, 'finish')
  await page.getByTestId(action.mode === 'bib_first' ? 'finish-mode-bib' : 'finish-mode-time').click()
  await page.getByTestId('finish-bib').fill(action.bib == null ? '' : String(action.bib))
  await page.getByTestId('finish-tap').click()
  await expect(page.locator(`[data-label="${action.tap_id}"]`)).toHaveAttribute('data-sync', 'ok')
}

async function correctTap(page: Page, action: RaceAction) {
  await open(page, 'corrections')
  const label = String(action.tap_id ?? action.source_tap_id)
  const storedId = await page.locator(`[data-label="${label}"]`).first().getAttribute('data-id')
  await page.getByTestId('corr-tap').fill(storedId || label)
  await page.getByTestId('corr-bib').fill(action.bib == null ? '' : String(action.bib))
  await page.getByTestId('corr-reason').fill(action.reason)
  const button = action.type === 'copy_time' ? 'corr-copy' : action.type === 'void' ? 'corr-void' : 'corr-assign'
  await page.getByTestId(button).click()
  await noError(page)
}

async function checkLockBlocked(page: Page, action: RaceAction) {
  await open(page, 'results')
  await page.getByTestId(`lock-${action.race}`).click()
  const items = page.getByTestId(`blockers-${action.race}`).getByTestId('blocker')
  const ids = action.expect_blockers as string[]
  const labels = ids.map((id) => blockerText(id))
  await expect(items).toHaveText(labels)
  const href = ids[0].startsWith('tie:') ? '#/ties' : '#/entries'
  await expect(items.nth(0).locator('a')).toHaveAttribute('href', href)
}

async function orderTie(page: Page, action: RaceAction) {
  const card = page.getByTestId(`tie-${action.race}-${action.display_time}`)
  const order = action.order as number[][]
  if (order.length === 1) {
    await card.getByTestId('tie-equal').click()
    return
  }
  if (action.display_time !== '22:13') return
  await card.getByTestId('tie-member-130').dragTo(card.getByTestId('tie-member-129'))
  const ids = await card.locator('[data-testid^="tie-member-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
  if (ids[0] !== 'tie-member-130') await card.getByTestId('tie-up-130').click()
}

async function confirmTie(page: Page, action: RaceAction) {
  await open(page, 'ties')
  const card = page.getByTestId(`tie-${action.race}-${action.display_time}`)
  await orderTie(page, action)
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
}

async function lockRace(page: Page, action: RaceAction) {
  await open(page, 'results')
  await page.getByTestId(`lock-${action.race}`).click()
  await noError(page)
}

async function editAfterLockRejected(page: Page) {
  await open(page, 'entries')
  await page.getByTestId('status-bib').fill('201')
  await page.getByTestId('status-value').selectOption('dns')
  await page.getByTestId('status-reason').fill('ei pitäisi onnistua')
  await page.getByTestId('status-save').click()
  await expect(page.getByTestId('form-error')).toContainText('EVENT_LOCKED')
}

const raceActions: Record<string, (page: Page, action: RaceAction) => Promise<void>> = {
  confirm_club_suggestion: confirmClubSuggestion,
  create_club: createClub,
  resolve_abbreviation_conflict: resolveAbbreviationConflict,
  merge_clubs: mergeClubs,
  register_late: registerLate,
  change_bib: changeBib,
  set_status: setStatus,
  set_start_offset: setStartOffset,
  change_race_rejected: changeRaceRejected,
  change_race: changeRace,
  start: startRace,
  finish_tap: finishTap,
  copy_time: correctTap,
  assign_bib: correctTap,
  void: correctTap,
  check_lock_blocked: checkLockBlocked,
  confirm_tie_order: confirmTie,
  lock: lockRace,
  edit_after_lock_rejected: (page) => editAfterLockRejected(page),
}

export async function runAction(page: Page, action: RaceAction) {
  const handler = raceActions[action.type]
  if (!handler) throw new Error(`unknown action ${action.type}`)
  await handler(page, action)
}
