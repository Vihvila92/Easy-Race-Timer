import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  AppError,
  DomainBus,
  HlcClock,
  addMonths,
  computeResults,
  createId,
  formatDuration,
  formatOffsetNote,
  parseIsoMs,
  suggestCategory,
  type CategoryDef,
  type CategoryWarning,
  type ComputeEntrant,
} from '@ert/core'
import { exportPrintHtml, exportResultsCsv } from '@ert/exporters'
import { formatWarnings, type Locale } from '@ert/i18n'
import {
  CONSENT_TEXT_VERSION,
  applyPublicPrivacy,
  clubStats,
  findDuplicatePairs,
  newClubId,
  norm,
  recognizeClubs,
  searchClubs,
  type ClubRef,
  type PrivacyEntrant,
} from '@ert/people'
import { massStart } from '@ert/race-formats'
import { AppDb, ORG_ID, type Row } from '@ert/storage'
import { ERTX_FORMAT_VERSION, ErtxError, packErtx, unpackErtx } from '@ert/sync'
import { touchButton } from '@ert/timing-sources'

export interface Settings {
  age_basis: 'birth_date' | 'birth_year'
  age_reference_date: string
  below_youngest_category: 'assign_with_warning' | 'reject'
  rounding: 'floor_1s'
  tie_resolution: 'confirmed_order'
  offset_start_policy_default: 'ranked' | 'unranked' | 'open_category'
  bib_ranges: Record<string, [number, number]>
  retention_months: number
  privacy_min_group_size: number
}

const DEFAULT_SETTINGS: Settings = {
  age_basis: 'birth_date',
  age_reference_date: '',
  below_youngest_category: 'assign_with_warning',
  rounding: 'floor_1s',
  tie_resolution: 'confirmed_order',
  offset_start_policy_default: 'ranked',
  bib_ranges: {},
  retention_months: 12,
  privacy_min_group_size: 3,
}

export class Clock {
  private fixed: number | null = null
  set(ms: number | null) { this.fixed = ms }
  now() { return this.fixed ?? Date.now() }
  iso() { return new Date(this.now()).toISOString() }
}

interface EventRow { id: string; name: string; organizer: string; location: string; date_start: string; timezone: string; sport: string; locale_default: string; pin_hash: string | null; settings_json: string }
interface RaceRow { id: string; event_id: string; name_fi: string; name_en: string; distance_m: number; start_mode: string; scheduled_start: number | null; actual_start_ms: number | null; open_category_id: string | null; locked_at: number | null; sort_order: number }
interface CategoryRow { id: string; race_id: string; code: string; name_fi: string; name_en: string; description_fi: string; description_en: string; gender: 'F' | 'M' | 'X' | null; min_age: number | null; max_age: number | null; ranked: number; auto_assign: number; start_offset_ms: number; sort_order: number }
interface EntryRow {
  id: string; race_id: string; person_id: string | null; category_id: string | null; category_source: string; bib: number | null
  late_registration: number; club_id: string | null; club_raw: string | null; club_abbr_raw: string | null; display_name: string | null
  birth_year_at_entry: number | null; gender_at_entry: string | null; anonymized_at: number | null; start_offset_ms: number
  start_offset_reason: string | null; offset_ranking: string; status: string; status_reason: string | null; race_change_note: string | null
  warnings_json: string | null; result_order: number | null; reg_seq: number; registered_at: number
}
interface PersonRow { id: string; first_name: string; last_name: string; gender: string; birth_date: string | null; birth_year: number | null; email: string | null; phone: string | null }
interface ClubRow { id: string; abbreviation: string | null; name: string; municipality: string | null; official_id: string | null; status: 'active' | 'pending' | 'merged'; merged_into_id: string | null; source: string }
interface TimingRow { id: string; race_id: string; timing_point_id: string; device_id: string; seq_no: number; source: string; device_time_ms: number; monotonic_ms: number | null; time_ms: number; bib: number | null; entry_id: string | null; mode: string | null; raw_json: string | null; created_at: number }
interface CorrectionRow { id: string; target_type: string; target_id: string; action: string; old_value_json: string | null; new_value_json: string | null; reason: string; by_device_id: string | null; hlc: string; created_at: number }
interface TieRow { id: string; race_id: string; display_time: string; display_time_s: number; member_entry_ids_json: string; order_json: string | null; basis: string | null; reason: string | null; reopened: number; created_at: number; hlc: string }

const SCRYPT_N = 2 ** 17
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAXMEM = 256 * 1024 * 1024

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`
}

function verifyPin(pin: string, stored: string): { ok: boolean; upgrade: boolean } {
  if (stored.startsWith('scrypt$')) {
    const [, nText, rText, pText, salt, hash] = stored.split('$')
    const n = Number(nText)
    const r = Number(rText)
    const p = Number(pText)
    if (!salt || !hash || !n || !r || !p) return { ok: false, upgrade: false }
    const next = scryptSync(pin, salt, 32, { N: n, r, p, maxmem: SCRYPT_MAXMEM })
    const prev = Buffer.from(hash, 'hex')
    const ok = next.length === prev.length && timingSafeEqual(next, prev)
    return { ok, upgrade: ok && (n < SCRYPT_N || r < SCRYPT_R || p < SCRYPT_P) }
  }
  const [salt, hash] = stored.split(':')
  if (!salt || !hash || salt.includes('$')) return { ok: false, upgrade: false }
  const next = scryptSync(pin, salt, 32)
  const prev = Buffer.from(hash, 'hex')
  const ok = next.length === prev.length && timingSafeEqual(next, prev)
  return { ok, upgrade: ok }
}

export class RaceService {
  private readonly hlc: HlcClock
  private pinFailures = 0
  private pinLockedUntil = 0
  readonly bus = new DomainBus()

  constructor(private readonly db: AppDb, readonly clock: Clock, private readonly deviceId = 'DEV_LAPTOP_1') {
    this.hlc = new HlcClock(deviceId, () => this.clock.now())
  }

  now() { return this.clock.now() }

  private stamp() {
    const now = this.now()
    return { now, hlc: this.hlc.tick() }
  }

  event(): EventRow {
    const row = this.db.get<EventRow>('SELECT * FROM event ORDER BY created_at LIMIT 1')
    if (!row) throw new AppError('NOT_FOUND', 'No event')
    return row
  }

  settings(): Settings {
    const row = this.db.get<EventRow>('SELECT * FROM event ORDER BY created_at LIMIT 1')
    if (!row) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.settings_json) }
  }

  locale(): Locale {
    const row = this.db.get<EventRow>('SELECT * FROM event ORDER BY created_at LIMIT 1')
    return row?.locale_default === 'en' ? 'en' : 'fi'
  }

  private assertPin(pin: string | undefined, required: boolean) {
    const row = this.db.get<EventRow>('SELECT * FROM event ORDER BY created_at LIMIT 1')
    if (!row?.pin_hash) return
    if (!required) return
    if (this.pinLockedUntil > this.now()) throw new AppError('PIN_REQUIRED', 'Too many PIN attempts')
    const result = pin ? verifyPin(pin, row.pin_hash) : { ok: false, upgrade: false }
    if (!result.ok) {
      this.pinFailures += 1
      if (this.pinFailures >= 5) this.pinLockedUntil = this.now() + 60_000
      throw new AppError('PIN_REQUIRED', 'PIN required')
    }
    this.pinFailures = 0
    if (result.upgrade) {
      this.db.run('UPDATE event SET pin_hash = ?, updated_at = ? WHERE id = ?', hashPin(pin!), this.now(), row.id)
    }
  }

  pinConfigured(): boolean {
    const row = this.db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM event LIMIT 1')
    return Boolean(row?.pin_hash)
  }

  setPin(pin: string, currentPin?: string) {
    if (!/^\d{4,8}$/.test(pin)) throw new AppError('VALIDATION_ERROR', 'PIN must be 4–8 digits')
    const event = this.event()
    if (event.pin_hash) {
      const result = currentPin ? verifyPin(currentPin, event.pin_hash) : { ok: false, upgrade: false }
      if (!result.ok) throw new AppError('PIN_REQUIRED', 'Current PIN required')
    }
    this.db.run('UPDATE event SET pin_hash = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', hashPin(pin), this.now(), this.hlc.tick(), event.id)
  }

  checkPin(pin: string | undefined) {
    this.assertPin(pin, true)
    return { ok: true }
  }

  importEvent(body: Record<string, unknown>) {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...(body.settings as Partial<Settings> | undefined),
      age_reference_date: ((body.settings as Settings | undefined)?.age_reference_date) || String(body.date),
    }
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO event (id, org_id, name, organizer, location, date_start, date_end, timezone, sport, locale_default, settings_json, created_at, updated_at, rev, hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        body.id, ORG_ID, body.name, body.organizer ?? '', body.location ?? '', body.date, body.date, body.timezone ?? 'Europe/Helsinki',
        body.sport ?? 'run', body.locale_default ?? 'fi', JSON.stringify(settings), now, now, hlc,
      )
      const races = (body.races as Record<string, unknown>[]) ?? []
      races.forEach((race, index) => {
        const name = race.name as { fi: string; en: string }
        this.db.run(
          `INSERT INTO race (id, org_id, event_id, name_fi, name_en, distance_m, start_mode, scheduled_start, open_category_id, sort_order, created_at, updated_at, hlc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          race.id, ORG_ID, body.id, name.fi, name.en, race.distance_m, race.start_mode ?? 'mass',
          race.scheduled_start ? parseIsoMs(String(race.scheduled_start)) : null,
          race.open_category_id ?? null, index, now, now, hlc,
        )
      })
      const categories = (body.categories as Record<string, unknown>[]) ?? []
      categories.forEach((category, index) => {
        const name = category.name as { fi: string; en: string }
        const description = (category.description as { fi?: string; en?: string } | undefined) ?? {}
        this.db.run(
          `INSERT INTO category (id, race_id, code, name_fi, name_en, description_fi, description_en, gender, min_age, max_age, ranked, auto_assign, start_offset_ms, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          category.id, category.race_id, category.id, name.fi, name.en, description.fi ?? '', description.en ?? '',
          category.gender ?? null, category.min_age ?? null, category.max_age ?? null,
          category.ranked === false ? 0 : 1, category.auto_assign === false ? 0 : 1, index,
        )
      })
      const points = (body.timing_points as { id: string; kind: string; name: string }[]) ?? [
        { id: 'TP_START', kind: 'start', name: 'Lähtö' },
        { id: 'TP_FINISH', kind: 'finish', name: 'Maali' },
      ]
      points.forEach((point, index) => {
        this.db.run('INSERT INTO timing_point (id, event_id, kind, name, order_no) VALUES (?, ?, ?, ?, ?)', point.id, body.id, point.kind, point.name, index)
      })
      const devices = (body.devices as { id: string; name: string; role?: string }[]) ?? []
      if (!devices.length) devices.push({ id: this.deviceId, name: 'Läppäri', role: 'primary' })
      for (const device of devices) {
        this.db.run(
          'INSERT INTO device (id, org_id, name, kind, role, is_primary_clock) VALUES (?, ?, ?, ?, ?, ?)',
          device.id, ORG_ID, device.name, 'touch', device.role ?? 'primary', device.role === 'primary' || device.id === this.deviceId ? 1 : 0,
        )
      }
    })
    return { id: body.id }
  }

  importClubs(clubs: { id: string; abbreviation: string | null; name: string; municipality?: string; official_id?: string }[]) {
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      for (const club of clubs) {
        this.db.run(
          `INSERT INTO club (id, org_id, abbreviation, name, municipality, official_id, status, source, created_at, updated_at, hlc)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'import', ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          club.id, ORG_ID, club.abbreviation, club.name, club.municipality ?? '', club.official_id ?? '', now, now, hlc,
        )
      }
    })
    return { count: clubs.length }
  }

  private categories(): CategoryRow[] {
    return this.db.all<CategoryRow>('SELECT * FROM category ORDER BY sort_order, id')
  }

  private categoryDefs(): CategoryDef[] {
    return this.categories().map((category) => ({
      id: category.id,
      raceId: category.race_id,
      gender: category.gender,
      minAge: category.min_age,
      maxAge: category.max_age,
      ranked: category.ranked === 1,
      autoAssign: category.auto_assign === 1,
    }))
  }

  private races(): RaceRow[] {
    return this.db.all<RaceRow>('SELECT * FROM race ORDER BY sort_order, id')
  }

  private raceByLabel(label: string): RaceRow {
    const needle = label.trim().toLowerCase()
    const race = this.races().find((item) => item.id.toLowerCase() === needle || item.name_fi.toLowerCase() === needle || item.name_en.toLowerCase() === needle)
    if (!race) throw new AppError('NOT_FOUND', `Race not found: ${label}`)
    return race
  }

  private clubRefs(): ClubRef[] {
    const clubs = this.db.all<ClubRow>('SELECT * FROM club')
    const aliases = this.db.all<{ club_id: string; alias_normalized: string }>('SELECT club_id, alias_normalized FROM club_alias')
    return clubs.map((club) => ({
      id: club.id,
      abbreviation: club.abbreviation,
      name: club.name,
      municipality: club.municipality ?? '',
      officialId: club.official_id ?? '',
      status: club.status,
      aliases: aliases.filter((alias) => alias.club_id === club.id).map((alias) => alias.alias_normalized),
    }))
  }

  private suggestFor(input: { gender: 'F' | 'M' | 'X'; birthDate: string | null; birthYear: number | null }, raceId: string, basis = this.settings().age_basis) {
    return suggestCategory(input, basis, raceId, this.categoryDefs(), this.settings().age_reference_date)
  }

  previewCsv(csvText: string) {
    const rows = parseEntries(csvText)
    const recognition = recognizeClubs(rows.map((row) => ({ name: row.seura, abbreviation: row.seuran_lyhenne })), this.clubRefs())
    const settings = this.settings()
    const preview = rows.map((row, index) => {
      const race = this.raceByLabel(row.matka)
      const person = personFromCsv(row)
      const errors = validateRow(row, settings.age_reference_date.slice(0, 4))
      const birthDate = this.suggestFor(person, race.id, 'birth_date')
      const birthYear = this.suggestFor(person, race.id, 'birth_year')
      const key = `${row.seura}\0${row.seuran_lyhenne}`
      const club = recognition.byKey.get(key)
      return {
        line: index + 2,
        bib: row.numero,
        name: `${row.sukunimi} ${row.etunimi}`,
        raceId: race.id,
        errors,
        birth_date: { age: birthDate.age, categoryId: birthDate.categoryId, warnings: formatWarnings(birthDate.warnings, 'fi') },
        birth_year: { age: birthYear.age, categoryId: birthYear.categoryId, warnings: formatWarnings(birthYear.warnings, 'fi') },
        club,
        clubRaw: row.seura,
        clubAbbr: row.seuran_lyhenne,
      }
    })
    const errors = preview.reduce((sum, row) => sum + row.errors.length, 0)
    return { count: preview.length, errors, rows: preview, clubs: recognition.matches, proposals: recognition.proposals }
  }

  importCsv(csvText: string) {
    const preview = this.previewCsv(csvText)
    if (preview.errors) throw new AppError('VALIDATION_ERROR', 'CSV has errors', { errors: preview.errors })
    const basis = this.settings().age_basis
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      for (const row of preview.rows) {
        const source = parseEntries(csvText)[row.line - 2]
        const suggestion = basis === 'birth_year' ? row.birth_year : row.birth_date
        const warnings = basis === 'birth_year'
          ? suggestCategory(personFromCsv(source), 'birth_year', row.raceId, this.categoryDefs(), this.settings().age_reference_date).warnings
          : suggestCategory(personFromCsv(source), 'birth_date', row.raceId, this.categoryDefs(), this.settings().age_reference_date).warnings
        const autoClub = row.club && ['abbreviation', 'name', 'normalized_name'].includes(row.club.type) ? row.club.clubId : null
        this.insertParticipant({
          firstName: source.etunimi,
          lastName: source.sukunimi,
          gender: mapGender(source.sukupuoli),
          birthDate: source.syntymaaika || null,
          birthYear: Number(source.syntymavuosi),
          email: source.sahkoposti || null,
          raceId: row.raceId,
          bib: Number(source.numero),
          clubId: autoClub,
          clubRaw: source.seura,
          clubAbbrRaw: source.seuran_lyhenne,
          categoryId: suggestion.categoryId || null,
          warnings,
          consent: source.pitkaaikainen_tallennus === 'kyllä',
          givenBy: source.suostumuksen_antaja === 'huoltaja' ? 'guardian' : undefined,
          channel: 'csv_import',
          late: false,
          now,
          hlc,
        })
      }
    })
    this.bus.emit('EntryChanged', { count: preview.count })
    return { count: preview.count, errors: 0 }
  }

  private insertParticipant(input: {
    firstName: string; lastName: string; gender: 'F' | 'M' | 'X'; birthDate: string | null; birthYear: number | null
    email: string | null; raceId: string; bib: number; clubId: string | null; clubRaw: string; clubAbbrRaw: string
    categoryId: string | null; warnings: CategoryWarning[]; consent: boolean; givenBy?: 'self' | 'guardian'
    channel: string; late: boolean; now: number; hlc: string
  }) {
    const dupBib = this.db.get('SELECT id FROM entry WHERE race_id = ? AND bib = ?', input.raceId, input.bib)
    if (dupBib) throw new AppError('BIB_IN_USE', `Bib ${input.bib} is already used`)
    if (input.birthYear != null) {
      const dup = this.db.get('SELECT id FROM person WHERE org_id = ? AND lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND birth_year = ?', ORG_ID, input.firstName, input.lastName, input.birthYear)
      if (dup) throw new AppError('ENTRY_EXISTS', 'Person already exists for this race identity')
    }
    const personId = createId()
    const entryId = createId()
    const reg = (this.db.get<{ m: number }>('SELECT COALESCE(MAX(reg_seq), 0) AS m FROM entry')?.m ?? 0) + 1
    this.db.run(
      `INSERT INTO person (id, org_id, first_name, last_name, gender, birth_date, birth_year, email, default_club_id, created_at, updated_at, hlc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      personId, ORG_ID, input.firstName, input.lastName, input.gender, input.birthDate, input.birthYear, input.email, input.clubId, input.now, input.now, input.hlc,
    )
    const age = input.birthDate ? suggestCategory({ gender: input.gender, birthDate: input.birthDate, birthYear: input.birthYear }, this.settings().age_basis, input.raceId, this.categoryDefs(), this.settings().age_reference_date).age : null
    const givenBy = input.givenBy ?? ((age != null && age < 13) ? 'guardian' : 'self')
    this.db.run(
      `INSERT INTO consent (id, person_id, purpose, granted, given_by, text_version, channel, recorded_by, recorded_at)
       VALUES (?, ?, 'long_term_storage', ?, ?, ?, ?, ?, ?)`,
      createId(), personId, input.consent ? 1 : 0, givenBy, CONSENT_TEXT_VERSION, input.channel, this.deviceId, input.now,
    )
    this.db.run(
      `INSERT INTO entry (id, org_id, race_id, person_id, category_id, category_source, bib, registered_at, late_registration, club_id, club_raw, club_abbr_raw,
        display_name, birth_year_at_entry, gender_at_entry, start_offset_ms, offset_ranking, status, warnings_json, reg_seq, created_at, updated_at, hlc)
       VALUES (?, ?, ?, ?, ?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'inherit', 'registered', ?, ?, ?, ?, ?)`,
      entryId, ORG_ID, input.raceId, personId, input.categoryId, input.bib, input.now, input.late ? 1 : 0, input.clubId, input.clubRaw, input.clubAbbrRaw,
      `${input.lastName} ${input.firstName}`, input.birthYear, input.gender, JSON.stringify(input.warnings), reg, input.now, input.now, input.hlc,
    )
    this.bus.emit('ConsentChanged', { personId, granted: input.consent })
    return entryId
  }

  suggestions(basis: Settings['age_basis']) {
    const locale = this.locale()
    return this.entries().map((entry) => {
      const person = entry.person_id ? this.db.get<PersonRow>('SELECT * FROM person WHERE id = ?', entry.person_id) : undefined
      if (!person || entry.anonymized_at) return null
      const suggestion = this.suggestFor({
        gender: person.gender as 'F' | 'M' | 'X',
        birthDate: person.birth_date,
        birthYear: person.birth_year,
      }, entry.race_id, basis)
      return {
        bib: entry.bib,
        name: entry.display_name,
        raceId: entry.race_id,
        age: suggestion.age,
        categoryId: suggestion.categoryId,
        warnings: formatWarnings(suggestion.warnings, locale),
      }
    }).filter(Boolean)
  }

  setAgeBasis(basis: Settings['age_basis'], apply: boolean) {
    const event = this.event()
    const settings = this.settings()
    settings.age_basis = basis
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run('UPDATE event SET settings_json = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', JSON.stringify(settings), now, hlc, event.id)
      if (!apply) return
      for (const entry of this.entries()) {
        if (entry.category_source === 'manual' || !entry.person_id || entry.anonymized_at) continue
        const person = this.db.get<PersonRow>('SELECT * FROM person WHERE id = ?', entry.person_id)
        if (!person) continue
        const suggestion = this.suggestFor({ gender: person.gender as 'F' | 'M' | 'X', birthDate: person.birth_date, birthYear: person.birth_year }, entry.race_id, basis)
        this.db.run('UPDATE entry SET category_id = ?, warnings_json = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?',
          suggestion.categoryId || null, JSON.stringify(suggestion.warnings), now, hlc, entry.id)
      }
    })
    return this.suggestions(basis)
  }

  setOffsetPolicy(policy: Settings['offset_start_policy_default']) {
    const event = this.event()
    const settings = this.settings()
    settings.offset_start_policy_default = policy
    const { now, hlc } = this.stamp()
    this.db.run('UPDATE event SET settings_json = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', JSON.stringify(settings), now, hlc, event.id)
    this.bus.emit('ResultsInvalidated', { policy })
  }

  entries() {
    return this.db.all<EntryRow>('SELECT * FROM entry ORDER BY reg_seq')
  }

  private entryByBib(bib: number): EntryRow {
    const rows = this.db.all<EntryRow>('SELECT * FROM entry WHERE bib = ?', bib)
    if (!rows.length) throw new AppError('NOT_FOUND', `Bib ${bib} not found`)
    return rows[0]
  }

  private assertUnlocked(raceId: string) {
    const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', raceId)
    if (!race) throw new AppError('NOT_FOUND', 'Race not found')
    if (race.locked_at) throw new AppError('EVENT_LOCKED', 'Event is locked')
  }

  private correct(targetType: string, targetId: string, action: string, reason: string, oldValue: unknown, newValue: unknown) {
    if (!reason?.trim()) throw new AppError('VALIDATION_ERROR', 'Reason is required')
    const { now, hlc } = this.stamp()
    this.db.run(
      `INSERT INTO correction (id, org_id, target_type, target_id, action, old_value_json, new_value_json, reason, by_device_id, hlc, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      createId(), ORG_ID, targetType, targetId, action, JSON.stringify(oldValue), JSON.stringify(newValue), reason.trim(), this.deviceId, hlc, now,
    )
    this.bus.emit('CorrectionApplied', { action, targetId })
    return hlc
  }

  confirmClubSuggestion(raw: string, clubId: string, addAlias: boolean, reason: string) {
    const club = this.db.get<ClubRow>('SELECT * FROM club WHERE id = ?', clubId)
    if (!club) throw new AppError('NOT_FOUND', 'Club not found')
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE club_raw = ? AND (club_id IS NULL OR club_id = ?)', raw, clubId)
      for (const entry of entries) {
        this.db.run('UPDATE entry SET club_id = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', clubId, now, hlc, entry.id)
      }
      if (addAlias) this.addAlias(clubId, raw, 'typo', 'import_confirm', now)
      this.correct('club', clubId, 'set_entry_club', reason, { raw }, { clubId, entries: entries.length })
    })
  }

  createClub(input: { raw?: string; abbreviation: string; name: string; municipality?: string; id?: string }) {
    const abbr = input.abbreviation.trim()
    if (!abbr) throw new AppError('VALIDATION_ERROR', 'Abbreviation is required')
    const taken = this.db.get('SELECT id FROM club WHERE status <> \'merged\' AND abbreviation IS NOT NULL AND lower(abbreviation) = lower(?)', abbr)
    if (taken) throw new AppError('CLUB_ABBREVIATION_TAKEN', `Abbreviation ${abbr} is taken`)
    const id = input.id || newClubId(abbr, input.name)
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO club (id, org_id, abbreviation, name, municipality, official_id, status, source, created_at, updated_at, hlc)
         VALUES (?, ?, ?, ?, ?, '', 'active', 'manual', ?, ?, ?)`,
        id, ORG_ID, abbr, input.name, input.municipality ?? '', now, now, hlc,
      )
      if (input.raw) {
        const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE club_raw = ?', input.raw)
        for (const entry of entries) this.db.run('UPDATE entry SET club_id = ?, updated_at = ?, hlc = ? WHERE id = ?', id, now, hlc, entry.id)
      }
    })
    return { id }
  }

  resolveAbbreviationConflict(input: { raw: string; abbreviation: string; resolution: 'same_club' | 'different'; clubId?: string; addAlias?: boolean; reason: string; otherAbbreviation?: string; otherName?: string }) {
    if (input.resolution === 'different') {
      return this.createClub({ raw: input.raw, abbreviation: input.otherAbbreviation || `${input.abbreviation}2`, name: input.otherName || input.raw })
    }
    const clubId = input.clubId
    if (!clubId) throw new AppError('VALIDATION_ERROR', 'Target club is required')
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE club_raw = ?', input.raw)
      for (const entry of entries) this.db.run('UPDATE entry SET club_id = ?, updated_at = ?, hlc = ? WHERE id = ?', clubId, now, hlc, entry.id)
      if (input.addAlias !== false) this.addAlias(clubId, input.raw, 'typo', 'import_confirm', now)
      this.correct('club', clubId, 'set_entry_club', input.reason, { raw: input.raw }, { clubId })
    })
    return { id: clubId }
  }

  private addAlias(clubId: string, alias: string, kind: string, createdFrom: string, now: number) {
    const normalized = norm(alias)
    if (!normalized) return
    const exists = this.db.get('SELECT id FROM club_alias WHERE org_id = ? AND alias_normalized = ?', ORG_ID, normalized)
    if (exists) return
    this.db.run(
      'INSERT INTO club_alias (id, org_id, club_id, alias_normalized, kind, created_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      createId(), ORG_ID, clubId, normalized, kind, createdFrom, now,
    )
  }

  mergeClubs(sourceId: string, targetId: string, addAlias: boolean, reason: string) {
    const source = this.db.get<ClubRow>('SELECT * FROM club WHERE id = ?', sourceId)
    const target = this.db.get<ClubRow>('SELECT * FROM club WHERE id = ?', targetId)
    if (!source || !target) throw new AppError('NOT_FOUND', 'Club not found')
    const { now, hlc } = this.stamp()
    const moved = this.db.tx(() => {
      const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE club_id = ?', sourceId)
      for (const entry of entries) this.db.run('UPDATE entry SET club_id = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', targetId, now, hlc, entry.id)
      this.db.run('UPDATE person SET default_club_id = ? WHERE default_club_id = ?', targetId, sourceId)
      if (addAlias) this.addAlias(targetId, source.name, 'name', 'merge', now)
      if (source.abbreviation) this.addAlias(targetId, source.abbreviation, 'abbreviation', 'merge', now)
      this.db.run(`UPDATE club SET status = 'merged', merged_into_id = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?`, targetId, now, hlc, sourceId)
      this.correct('club', sourceId, 'merge_clubs', reason, { sourceId, entryIds: entries.map((entry) => entry.id) }, { targetId })
      return entries.length
    })
    return { moved }
  }

  undoMerge(sourceId: string, reason: string) {
    const correction = this.db.all<CorrectionRow>(`SELECT * FROM correction WHERE action = 'merge_clubs' AND target_id = ? ORDER BY created_at DESC`, sourceId)[0]
    if (!correction?.old_value_json) throw new AppError('NOT_FOUND', 'Merge not found')
    const old = JSON.parse(correction.old_value_json) as { entryIds: string[] }
    const next = JSON.parse(correction.new_value_json ?? '{}') as { targetId: string }
    const { now, hlc } = this.stamp()
    const restored = this.db.tx(() => {
      const entryIds = old.entryIds ?? []
      for (const entryId of entryIds) this.db.run('UPDATE entry SET club_id = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', sourceId, now, hlc, entryId)
      this.db.run(`UPDATE club SET status = 'active', merged_into_id = NULL, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?`, now, hlc, sourceId)
      this.correct('club', sourceId, 'restore', reason, { targetId: next.targetId }, { sourceId })
      return entryIds.length
    })
    return { restored }
  }

  searchClubs(query: string) {
    const hits = searchClubs(this.clubRefs(), query)
    return hits.map((club) => ({ id: club.id, abbreviation: club.abbreviation, name: club.name, label: `${club.abbreviation} – ${club.name}` }))
  }

  duplicateClubs() {
    return findDuplicatePairs(this.clubRefs())
  }

  listClubs() {
    const clubs = this.db.all<ClubRow>('SELECT * FROM club ORDER BY name')
    return clubs.map((club) => ({
      ...club,
      aliases: this.db.all<{ alias_normalized: string }>('SELECT alias_normalized FROM club_alias WHERE club_id = ?', club.id).map((alias) => alias.alias_normalized),
      entries: this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entry WHERE club_id = ?', club.id)?.n ?? 0,
    }))
  }

  changeBib(bibFrom: number, bibTo: number, reason: string) {
    const entry = this.entryByBib(bibFrom)
    this.assertUnlocked(entry.race_id)
    if (bibTo <= 0) throw new AppError('VALIDATION_ERROR', 'Bib must be positive')
    const taken = this.db.get('SELECT id FROM entry WHERE race_id = ? AND bib = ? AND id <> ?', entry.race_id, bibTo, entry.id)
    if (taken) throw new AppError('BIB_IN_USE', `Bib ${bibTo} is already used`)
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run('UPDATE entry SET bib = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', bibTo, now, hlc, entry.id)
      this.correct('entry', entry.id, 'change_bib', reason, { bib: bibFrom }, { bib: bibTo })
    })
  }

  setStatus(bib: number, status: string, reason: string) {
    const entry = this.entryByBib(bib)
    this.assertUnlocked(entry.race_id)
    if (!['registered', 'started', 'finished', 'dns', 'dnf', 'dsq'].includes(status)) {
      throw new AppError('VALIDATION_ERROR', 'Unknown status')
    }
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run('UPDATE entry SET status = ?, status_reason = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', status, reason, now, hlc, entry.id)
      this.correct('entry', entry.id, 'set_status', reason, { status: entry.status }, { status })
    })
  }

  setStartOffset(bib: number, offsetMs: number, reason: string, ranking?: string) {
    const entry = this.entryByBib(bib)
    this.assertUnlocked(entry.race_id)
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run(
        'UPDATE entry SET start_offset_ms = ?, start_offset_reason = ?, offset_ranking = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?',
        offsetMs, reason, ranking ?? entry.offset_ranking, now, hlc, entry.id,
      )
      this.correct('entry', entry.id, 'set_start_offset', reason, { offsetMs: entry.start_offset_ms }, { offsetMs })
    })
  }

  changeRace(bib: number, raceLabel: string, bibTo: number | undefined, reason: string) {
    const entry = this.entryByBib(bib)
    const target = this.raceByLabel(raceLabel)
    this.assertUnlocked(entry.race_id)
    this.assertUnlocked(target.id)
    const person = entry.person_id ? this.db.get<PersonRow>('SELECT * FROM person WHERE id = ?', entry.person_id) : undefined
    if (!person) throw new AppError('NOT_FOUND', 'Person missing')
    const suggestion = this.suggestFor({ gender: person.gender as 'F' | 'M' | 'X', birthDate: person.birth_date, birthYear: person.birth_year }, target.id)
    if (!suggestion.categoryId) {
      throw new AppError('NO_MATCHING_CATEGORY', formatWarnings(suggestion.warnings, 'fi'), { warnings: suggestion.warnings })
    }
    const nextBib = bibTo ?? bib
    const taken = this.db.get('SELECT id FROM entry WHERE race_id = ? AND bib = ?', target.id, nextBib)
    if (taken) throw new AppError('BIB_IN_USE', `Bib ${nextBib} is already used`)
    const from = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', entry.race_id)!
    const note = `Vaihtoi matkaa ${from.name_fi} → ${target.name_fi}`
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run(
        `UPDATE entry SET race_id = ?, bib = ?, category_id = ?, category_source = 'auto', race_change_note = ?, warnings_json = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?`,
        target.id, nextBib, suggestion.categoryId, note, JSON.stringify(suggestion.warnings), now, hlc, entry.id,
      )
      this.correct('entry', entry.id, 'change_race', reason, { raceId: entry.race_id, bib }, { raceId: target.id, bib: nextBib, categoryId: suggestion.categoryId })
    })
    return { categoryId: suggestion.categoryId }
  }

  registerLate(input: {
    firstName: string; lastName: string; gender: 'F' | 'M' | 'X'; birthDate: string | null; email?: string
    clubQuery?: string; raceId: string; bib: number; consent: boolean
  }) {
    const race = this.raceByLabel(input.raceId)
    this.assertUnlocked(race.id)
    const birthYear = input.birthDate ? Number(input.birthDate.slice(0, 4)) : null
    const suggestion = this.suggestFor({ gender: input.gender, birthDate: input.birthDate, birthYear }, race.id)
    const clubHits = input.clubQuery ? this.searchClubs(input.clubQuery) : []
    const { now, hlc } = this.stamp()
    const entryId = this.db.tx(() => this.insertParticipant({
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      birthDate: input.birthDate,
      birthYear,
      email: input.email || null,
      raceId: race.id,
      bib: input.bib,
      clubId: clubHits[0]?.id ?? null,
      clubRaw: input.clubQuery ?? '',
      clubAbbrRaw: '',
      categoryId: suggestion.categoryId || null,
      warnings: suggestion.warnings,
      consent: input.consent,
      channel: 'registration_form',
      late: true,
      now,
      hlc,
    }))
    return { entryId, categoryId: suggestion.categoryId, clubId: clubHits[0]?.id ?? '', warnings: formatWarnings(suggestion.warnings, this.locale()) }
  }

  startRace(raceId: string, timeMs: number, confirm = false) {
    const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', raceId)
    if (!race) throw new AppError('NOT_FOUND', 'Race not found')
    this.assertUnlocked(raceId)
    if (race.actual_start_ms != null && !confirm) {
      throw new AppError('VALIDATION_ERROR', 'Start already recorded', { alreadyStarted: true, startMs: race.actual_start_ms })
    }
    if (race.actual_start_ms != null && confirm) return { startMs: race.actual_start_ms, unchanged: true }
    const point = this.finishPoint('start')
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run('UPDATE race SET actual_start_ms = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', timeMs, now, hlc, raceId)
      this.db.run(`UPDATE entry SET status = 'started', updated_at = ?, hlc = ? WHERE race_id = ? AND status = 'registered'`, now, hlc, raceId)
      this.insertTiming({
        raceId,
        pointId: point,
        timeMs,
        bib: null,
        entryId: null,
        mode: 'mass_start',
        source: 'touch',
        raw: { kind: 'start' },
        now,
      })
    })
    this.bus.emit('TimingEventRecorded', { raceId, kind: 'start' })
    return { startMs: timeMs }
  }

  private finishPoint(kind: 'start' | 'finish') {
    const point = this.db.get<{ id: string }>('SELECT id FROM timing_point WHERE kind = ? ORDER BY order_no LIMIT 1', kind)
    if (!point) throw new AppError('NOT_FOUND', `Timing point ${kind} missing`)
    return point.id
  }

  private insertTiming(input: { id?: string; raceId: string; pointId: string; timeMs: number; bib: number | null; entryId: string | null; mode: string; source: string; raw: unknown; now: number }) {
    if (input.id) {
      const existing = this.db.get<TimingRow>('SELECT * FROM timing_event WHERE id = ?', input.id)
      if (existing) return existing
    }
    const device = input.id ? this.deviceId : this.deviceId
    this.ensureDevice(device)
    const seq = this.db.get<{ next_seq: number }>('SELECT next_seq FROM device WHERE id = ?', device)!.next_seq
    this.db.run('UPDATE device SET next_seq = ? WHERE id = ?', seq + 1, device)
    const id = input.id || createId()
    const normalized = touchButton.normalize({ timeMs: input.timeMs, bib: input.bib, mode: input.mode })[0]
    this.db.run(
      `INSERT INTO timing_event (id, org_id, race_id, timing_point_id, device_id, seq_no, source, device_time_ms, monotonic_ms, time_ms, bib, entry_id, mode, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ORG_ID, input.raceId, input.pointId, device, seq, input.source, normalized.timeMs, normalized.timeMs, normalized.timeMs,
      normalized.bib, input.entryId, normalized.mode, JSON.stringify(input.raw), input.now,
    )
    return this.db.get<TimingRow>('SELECT * FROM timing_event WHERE id = ?', id)!
  }

  private ensureDevice(id: string) {
    const row = this.db.get('SELECT id FROM device WHERE id = ?', id)
    if (!row) this.db.run('INSERT INTO device (id, org_id, name, kind, role, is_primary_clock) VALUES (?, ?, ?, ?, ?, 1)', id, ORG_ID, id, 'touch', 'primary')
  }

  private resolveRaceId(bib: number | null, timeMs: number): string {
    if (bib != null) {
      const entry = this.db.get<EntryRow>('SELECT * FROM entry WHERE bib = ?', bib)
      if (entry) return entry.race_id
      for (const [raceId, range] of Object.entries(this.settings().bib_ranges)) {
        if (bib >= range[0] && bib <= range[1]) return raceId
      }
    }
    const started = this.races().filter((race) => race.actual_start_ms != null && race.actual_start_ms <= timeMs)
    started.sort((a, b) => (b.actual_start_ms ?? 0) - (a.actual_start_ms ?? 0))
    if (started[0]) return started[0].id
    return this.races()[0]?.id ?? (() => { throw new AppError('RACE_NOT_STARTED', 'No race') })()
  }

  recordFinish(input: { id?: string; timeMs: number; bib?: number | null; mode?: string; deviceId?: string }) {
    const bib = input.bib ?? null
    const raceId = this.resolveRaceId(bib, input.timeMs)
    this.assertUnlocked(raceId)
    const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', raceId)
    if (!race?.actual_start_ms) throw new AppError('RACE_NOT_STARTED', 'Race has not started')
    const entry = bib == null ? undefined : this.db.get<EntryRow>('SELECT * FROM entry WHERE bib = ?', bib)
    const flags: string[] = []
    if (bib != null && !entry) flags.push('unknown_bib')
    if (entry) {
      const previous = this.activeFinishes().filter((event) => event.entry_id === entry.id)
      if (previous.length) flags.push('duplicate')
    }
    const { now } = this.stamp()
    const event = this.db.tx(() => this.insertTiming({
      id: input.id,
      raceId: entry?.race_id ?? raceId,
      pointId: this.finishPoint('finish'),
      timeMs: input.timeMs,
      bib,
      entryId: entry?.id ?? null,
      mode: input.mode ?? 'time_first',
      source: 'touch',
      raw: { flags },
      now,
    }))
    this.bus.emit('TimingEventRecorded', { id: event.id })
    this.bus.emit('ResultsInvalidated', { raceId })
    return { id: event.id, flags, raceId: event.race_id }
  }

  private voidedIds() {
    const rows = this.db.all<CorrectionRow>(`SELECT * FROM correction WHERE action IN ('void', 'restore') ORDER BY created_at, id`)
    const voided = new Set<string>()
    for (const row of rows) {
      if (row.action === 'void') voided.add(row.target_id)
      if (row.action === 'restore') voided.delete(row.target_id)
    }
    return voided
  }

  private activeFinishes() {
    const voided = this.voidedIds()
    const point = this.db.get<{ id: string }>('SELECT id FROM timing_point WHERE kind = ? ORDER BY order_no LIMIT 1', 'finish')
    if (!point) return []
    return this.db.all<TimingRow>('SELECT * FROM timing_event WHERE timing_point_id = ? ORDER BY time_ms, created_at', point.id)
      .filter((event) => !voided.has(event.id))
  }

  timingEvents() {
    const voided = this.voidedIds()
    return this.db.all<TimingRow>('SELECT * FROM timing_event ORDER BY created_at').map((event) => ({
      ...event,
      voided: voided.has(event.id),
      flags: JSON.parse(event.raw_json ?? '{}').flags ?? [],
    }))
  }

  assignBib(tapId: string, bib: number, reason: string) {
    const event = this.db.get<TimingRow>('SELECT * FROM timing_event WHERE id = ?', tapId)
    if (!event) throw new AppError('NOT_FOUND', 'Timing event not found')
    const entry = this.entryByBib(bib)
    this.assertUnlocked(entry.race_id)
    this.db.tx(() => {
      this.db.run('UPDATE timing_event SET bib = ?, entry_id = ?, race_id = ? WHERE id = ?', bib, entry.id, entry.race_id, tapId)
      this.correct('timing_event', tapId, 'assign_bib', reason, { bib: event.bib, entryId: event.entry_id }, { bib, entryId: entry.id })
    })
  }

  voidTap(tapId: string, reason: string) {
    const event = this.db.get<TimingRow>('SELECT * FROM timing_event WHERE id = ?', tapId)
    if (!event) throw new AppError('NOT_FOUND', 'Timing event not found')
    this.assertUnlocked(event.race_id)
    this.correct('timing_event', tapId, 'void', reason, { timeMs: event.time_ms }, { voided: true })
  }

  restoreTap(tapId: string, reason: string) {
    const event = this.db.get<TimingRow>('SELECT * FROM timing_event WHERE id = ?', tapId)
    if (!event) throw new AppError('NOT_FOUND', 'Timing event not found')
    this.assertUnlocked(event.race_id)
    this.correct('timing_event', tapId, 'restore', reason, { voided: true }, { voided: false })
  }

  copyTime(sourceTapId: string, bib: number, reason: string) {
    const source = this.db.get<TimingRow>('SELECT * FROM timing_event WHERE id = ?', sourceTapId)
    if (!source) throw new AppError('NOT_FOUND', 'Timing event not found')
    const entry = this.entryByBib(bib)
    this.assertUnlocked(entry.race_id)
    const { now } = this.stamp()
    const created = this.db.tx(() => {
      const event = this.insertTiming({
        raceId: entry.race_id,
        pointId: source.timing_point_id,
        timeMs: source.time_ms,
        bib,
        entryId: entry.id,
        mode: 'copy',
        source: 'manual',
        raw: { copiedFrom: sourceTapId },
        now,
      })
      this.correct('timing_event', event.id, 'copy_time', reason, { sourceTapId }, { bib, timeMs: source.time_ms })
      return event
    })
    return { id: created.id }
  }

  lockBlockers(raceId: string): string[] {
    const blockers: string[] = []
    for (const entry of this.entries().filter((item) => item.race_id === raceId)) {
      if (['dns', 'dnf', 'dsq'].includes(entry.status)) continue
      const finish = this.activeFinishes().find((event) => event.entry_id === entry.id)
      if (!finish) blockers.push(`entry:${entry.bib}:no_result`)
    }
    for (const event of this.activeFinishes().filter((item) => item.race_id === raceId)) {
      if (!event.entry_id) blockers.push(`time:${event.id}:unassigned`)
    }
    for (const group of this.tieGroups().filter((group) => group.raceId === raceId && group.status === 'unconfirmed')) {
      blockers.push(`tie:${raceId}:${group.displayTime}`)
    }
    return blockers
  }

  lockRace(raceId: string) {
    const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', raceId)
    if (!race) throw new AppError('NOT_FOUND', 'Race not found')
    const blockers = this.lockBlockers(raceId)
    if (blockers.length) throw new AppError('LOCK_BLOCKED', 'Lock blocked', { blockers })
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run('UPDATE race SET locked_at = ?, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', now, now, hlc, raceId)
      this.correct('race', raceId, 'lock', 'Lukitus', { locked: false }, { locked: true })
    })
  }

  unlockRace(raceId: string, reason: string) {
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run('UPDATE race SET locked_at = NULL, updated_at = ?, rev = rev + 1, hlc = ? WHERE id = ?', now, hlc, raceId)
      this.correct('race', raceId, 'unlock', reason, { locked: true }, { locked: false })
    })
  }

  tieGroups() {
    const finishes = this.activeFinishes().filter((event) => event.entry_id)
    const groups = new Map<string, TimingRow[]>()
    for (const event of finishes) {
      const entry = this.db.get<EntryRow>('SELECT * FROM entry WHERE id = ?', event.entry_id)
      if (!entry || ['dns', 'dnf', 'dsq'].includes(entry.status)) continue
      const first = this.activeFinishes().filter((item) => item.entry_id === entry.id).sort((a, b) => a.time_ms - b.time_ms || a.created_at - b.created_at)[0]
      if (!first || first.id !== event.id) continue
      const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', entry.race_id)
      if (!race?.actual_start_ms) continue
      const category = this.categories().find((item) => item.id === entry.category_id)
      const start = massStart.startTimeFor({
        massStartMs: race.actual_start_ms,
        categoryOffsetMs: category?.start_offset_ms ?? 0,
        entryOffsetMs: entry.start_offset_ms,
        ownStartMs: null,
      })
      if (start == null) continue
      const timeMs = event.time_ms - start
      const sec = Math.floor(timeMs / 1000)
      const key = `${entry.race_id}:${sec}`
      const list = groups.get(key) ?? []
      list.push(event)
      groups.set(key, list)
    }
    const resolutions = this.db.all<TieRow>('SELECT * FROM tie_resolution ORDER BY created_at')
    const result: {
      raceId: string; displayTime: string; displayTimeS: number; status: 'confirmed' | 'unconfirmed'
      members: { entryId: string; bib: number | null; name: string; categoryId: string; timeMs: number; deviceId: string }[]
      order: string[][]; basis: string | null; reason: string | null; confirmedAt: number | null
    }[] = []
    for (const [key, events] of groups) {
      if (events.length < 2) continue
      const [raceId, secText] = key.split(':')
      const sec = Number(secText)
      const members = events.map((event) => {
        const entry = this.db.get<EntryRow>('SELECT * FROM entry WHERE id = ?', event.entry_id)!
        const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', entry.race_id)!
        const category = this.categories().find((item) => item.id === entry.category_id)
        const start = massStart.startTimeFor({ massStartMs: race.actual_start_ms, categoryOffsetMs: category?.start_offset_ms ?? 0, entryOffsetMs: entry.start_offset_ms, ownStartMs: null }) ?? 0
        return {
          entryId: entry.id,
          bib: entry.bib,
          name: entry.display_name ?? '',
          categoryId: entry.category_id ?? '',
          timeMs: event.time_ms - start,
          deviceId: event.device_id,
          orderKey: entry.result_order ?? entry.bib ?? entry.reg_seq,
        }
      }).sort((a, b) => a.timeMs - b.timeMs || a.orderKey - b.orderKey)
      const memberIds = members.map((member) => member.entryId).sort()
      const latest = [...resolutions].reverse().find((row) => row.race_id === raceId && row.display_time_s === sec)
      const sameMembers = latest && JSON.stringify(JSON.parse(latest.member_entry_ids_json).sort()) === JSON.stringify(memberIds)
      const confirmed = Boolean(latest && sameMembers && !latest.reopened && latest.order_json)
      result.push({
        raceId,
        displayTime: formatDuration(sec * 1000),
        displayTimeS: sec,
        status: confirmed ? 'confirmed' : 'unconfirmed',
        members: members.map(({ orderKey: _order, ...member }) => member),
        order: confirmed ? JSON.parse(latest!.order_json!) as string[][] : members.map((member) => [member.entryId]),
        basis: confirmed ? latest!.basis : null,
        reason: confirmed ? latest!.reason : null,
        confirmedAt: confirmed ? latest!.created_at : null,
      })
    }
    result.sort((a, b) => a.raceId.localeCompare(b.raceId) || a.displayTimeS - b.displayTimeS)
    return result
  }

  confirmTie(input: { raceId: string; displayTime: string; orderBibs: number[][]; basis: string; reason: string }) {
    this.assertUnlocked(input.raceId)
    if (!input.basis) throw new AppError('VALIDATION_ERROR', 'Basis is required')
    const group = this.tieGroups().find((item) => item.raceId === input.raceId && item.displayTime === input.displayTime)
    if (!group) throw new AppError('NOT_FOUND', 'Tie group not found')
    const bibToEntry = new Map(group.members.map((member) => [member.bib, member.entryId]))
    const order = input.orderBibs.map((groupBibs) => groupBibs.map((bib) => {
      const entryId = bibToEntry.get(bib)
      if (!entryId) throw new AppError('VALIDATION_ERROR', `Bib ${bib} is not in the tie`)
      return entryId
    }))
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO tie_resolution (id, org_id, race_id, display_time, display_time_s, member_entry_ids_json, order_json, basis, reason, confirmed_by_device_id, reopened, hlc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        createId(), ORG_ID, input.raceId, input.displayTime, group.displayTimeS, JSON.stringify(group.members.map((member) => member.entryId)),
        JSON.stringify(order), input.basis, input.reason, this.deviceId, hlc, now,
      )
      this.correct('race', `${input.raceId}:${input.displayTime}`, 'confirm_tie', input.reason, null, { order: input.orderBibs, basis: input.basis })
    })
  }

  undoTie(raceId: string, displayTime: string, reason: string) {
    this.assertUnlocked(raceId)
    const group = this.tieGroups().find((item) => item.raceId === raceId && item.displayTime === displayTime)
    if (!group) throw new AppError('NOT_FOUND', 'Tie group not found')
    const { now, hlc } = this.stamp()
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO tie_resolution (id, org_id, race_id, display_time, display_time_s, member_entry_ids_json, order_json, basis, reason, confirmed_by_device_id, reopened, hlc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?)`,
        createId(), ORG_ID, raceId, displayTime, group.displayTimeS, JSON.stringify(group.members.map((member) => member.entryId)),
        reason, this.deviceId, hlc, now,
      )
      this.correct('race', `${raceId}:${displayTime}`, 'restore', reason, { confirmed: true }, { reopened: true })
    })
  }

  private buildEntrants(locale: Locale): ComputeEntrant[] {
    const settings = this.settings()
    const ties = this.tieGroups()
    const entrants: ComputeEntrant[] = []
    for (const entry of this.entries()) {
      if (!['dns', 'dnf', 'dsq'].includes(entry.status)) {
        const finish = this.activeFinishes().filter((event) => event.entry_id === entry.id)
          .sort((a, b) => a.time_ms - b.time_ms || a.created_at - b.created_at)[0]
        if (!finish && !['dns', 'dnf', 'dsq'].includes(entry.status)) {
          // Still listed once a terminal status exists. Open entries without a finish stay out of the result rows.
        }
      }
      const race = this.db.get<RaceRow>('SELECT * FROM race WHERE id = ?', entry.race_id)!
      const category = this.categories().find((item) => item.id === entry.category_id)
      const club = entry.club_id ? this.db.get<ClubRow>('SELECT * FROM club WHERE id = ?', entry.club_id) : undefined
      let status: ComputeEntrant['status'] = 'OK'
      if (entry.status === 'dns') status = 'DNS'
      else if (entry.status === 'dnf') status = 'DNF'
      else if (entry.status === 'dsq') status = 'DSQ'
      const finish = status === 'OK'
        ? this.activeFinishes().filter((event) => event.entry_id === entry.id).sort((a, b) => a.time_ms - b.time_ms || a.created_at - b.created_at)[0]
        : undefined
      if (status === 'OK' && !finish) continue
      const start = massStart.startTimeFor({
        massStartMs: race.actual_start_ms,
        categoryOffsetMs: category?.start_offset_ms ?? 0,
        entryOffsetMs: entry.start_offset_ms,
        ownStartMs: null,
      })
      const timeMs = finish && start != null ? finish.time_ms - start : null
      let categoryId = entry.category_id ?? ''
      let ranked = category ? category.ranked === 1 : true
      const notes: string[] = []
      if (entry.start_offset_ms) notes.push(formatOffsetNote(entry.start_offset_ms))
      if (entry.late_registration) notes.push(locale === 'en' ? 'Late entry' : 'Jälki-ilmoittautunut')
      if (entry.race_change_note) notes.push(entry.race_change_note)
      const policy = entry.offset_ranking === 'inherit' ? settings.offset_start_policy_default : entry.offset_ranking
      if (entry.start_offset_ms < 0 && policy === 'unranked') {
        ranked = false
        notes.push(locale === 'en' ? 'Unranked' : 'Sijoittamaton')
      } else if (entry.start_offset_ms < 0 && policy === 'open_category' && race.open_category_id) {
        categoryId = race.open_category_id
        ranked = false
      }
      let tieIndex = 0
      let unconfirmed = false
      if (timeMs != null) {
        const sec = Math.floor(timeMs / 1000)
        const group = ties.find((item) => item.raceId === entry.race_id && item.displayTimeS === sec)
        if (group) {
          if (group.status === 'confirmed') {
            tieIndex = Math.max(0, group.order.findIndex((ids) => ids.includes(entry.id)))
          } else {
            unconfirmed = true
            tieIndex = 0
          }
        }
      }
      if (unconfirmed) notes.push(locale === 'en' ? 'Unconfirmed order' : 'Vahvistamaton järjestys')
      const clubAbbr = club?.abbreviation || (club ? club.name : '')
      entrants.push({
        entryId: entry.id,
        raceId: entry.race_id,
        categoryId,
        bib: entry.bib,
        name: entry.display_name ?? (locale === 'en' ? 'Anonymous' : 'Anonyymi'),
        clubAbbr: clubAbbr ?? '',
        clubName: club?.name ?? '',
        status,
        timeMs,
        ranked,
        note: notes.join('; '),
        tieIndex,
        orderKey: entry.result_order ?? entry.bib ?? entry.reg_seq,
      })
    }
    return entrants
  }

  results(view: 'public' | 'internal' = 'public') {
    const locale = this.locale()
    const races = this.races()
    const categories = this.categories()
    const categoryIdsByRace: Record<string, string[]> = {}
    for (const race of races) categoryIdsByRace[race.id] = categories.filter((category) => category.race_id === race.id).map((category) => category.id)
    const rows = computeResults({
      raceIds: races.map((race) => race.id),
      categoryIdsByRace,
      entrants: this.buildEntrants(locale),
    })
    if (view === 'internal') return rows
    const privacy: PrivacyEntrant[] = this.entries().map((entry) => ({
      entryId: entry.id,
      raceId: entry.race_id,
      categoryId: entry.category_id ?? '',
      clubId: entry.club_id,
      clubAbbr: '',
      anonymized: entry.anonymized_at != null,
    }))
    return applyPublicPrivacy(rows, privacy, this.settings().privacy_min_group_size, locale)
  }

  resultsCsv(view: 'public' | 'internal' = 'public') {
    return exportResultsCsv(this.results(view), true)
  }

  resultsHtml(localeOverride?: Locale) {
    const locale = localeOverride ?? this.locale()
    const event = this.event()
    const rows = this.results('public')
    const categories = this.categories().filter((category) => category.ranked === 1).map((category) => ({
      id: category.id,
      raceId: category.race_id,
      title: locale === 'en' ? category.name_en : category.name_fi,
      ranked: category.ranked === 1,
    }))
    return exportPrintHtml({ eventName: event.name, locale, categories, rows })
  }

  clubStatistics() {
    const entrants = this.entries().map((entry) => {
      const club = entry.club_id ? this.db.get<ClubRow>('SELECT * FROM club WHERE id = ?', entry.club_id) : undefined
      const finished = !['dns', 'dnf', 'dsq'].includes(entry.status) && this.activeFinishes().some((event) => event.entry_id === entry.id)
      return {
        raceId: entry.race_id,
        clubId: entry.club_id,
        clubAbbr: club?.abbreviation || (club ? '' : ''),
        clubName: club?.name ?? '',
        finished,
      }
    })
    return clubStats(entrants, this.settings().privacy_min_group_size, this.locale())
  }

  audit() {
    return this.db.all<CorrectionRow>('SELECT * FROM correction ORDER BY created_at, id')
  }

  consents() {
    return this.db.all<Row>('SELECT * FROM consent ORDER BY recorded_at')
  }

  runRetention(nowMs = this.now()) {
    const event = this.event()
    const settings = this.settings()
    const cutoff = addMonths(event.date_start, settings.retention_months)
    const today = new Date(nowMs).toISOString().slice(0, 10)
    if (today <= cutoff) return { anonymized: 0, cutoff }
    const removedNames: string[] = []
    const removedEmails: string[] = []
    const removedDates: string[] = []
    const removedBibs: number[] = []
    const count = this.db.tx(() => {
      for (const race of this.races()) {
        const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE race_id = ? AND bib IS NOT NULL ORDER BY bib', race.id)
        entries.forEach((entry, index) => {
          this.db.run('UPDATE entry SET result_order = ? WHERE id = ?', index, entry.id)
        })
      }
      let n = 0
      const people = this.db.all<PersonRow>('SELECT * FROM person')
      for (const person of people) {
        const consent = this.db.get<{ granted: number }>('SELECT granted FROM consent WHERE person_id = ? AND purpose = \'long_term_storage\' ORDER BY recorded_at DESC LIMIT 1', person.id)
        if (consent?.granted) continue
        const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE person_id = ?', person.id)
        const fullName = `${person.last_name} ${person.first_name}`
        removedNames.push(fullName, `${person.first_name} ${person.last_name}`)
        if (person.email) removedEmails.push(person.email)
        if (person.birth_date) removedDates.push(person.birth_date)
        for (const entry of entries) {
          if (entry.bib != null) removedBibs.push(entry.bib)
          this.db.run(
            `UPDATE entry SET person_id = NULL, display_name = NULL, birth_year_at_entry = NULL, bib = NULL, club_raw = NULL, club_abbr_raw = NULL,
             anonymized_at = ?, status_reason = CASE WHEN status_reason IS NULL THEN NULL ELSE '[poistettu]' END, updated_at = ? WHERE id = ?`,
            nowMs, nowMs, entry.id,
          )
          this.db.run('UPDATE timing_event SET bib = NULL WHERE entry_id = ?', entry.id)
        }
        this.db.run('DELETE FROM person WHERE id = ?', person.id)
        n += 1
      }
      if (removedBibs.length || removedNames.length) this.scrubText(removedNames, removedEmails, removedDates, removedBibs)
      return n
    })
    return { anonymized: count, cutoff }
  }

  private scrubText(names: string[], emails: string[], dates: string[], bibs: number[]) {
    const corrections = this.db.all<CorrectionRow>('SELECT * FROM correction')
    for (const row of corrections) {
      let reason = row.reason
      let oldValue = row.old_value_json ?? ''
      let newValue = row.new_value_json ?? ''
      for (const token of [...names, ...emails, ...dates]) {
        if (!token) continue
        reason = reason.split(token).join('[poistettu]')
        oldValue = oldValue.split(token).join('[poistettu]')
        newValue = newValue.split(token).join('[poistettu]')
      }
      for (const bib of bibs) {
        const pattern = new RegExp(`(?<![\\d])${bib}(?![\\d])`, 'g')
        reason = reason.replace(pattern, '[poistettu]')
        oldValue = oldValue.replace(pattern, '[poistettu]')
        newValue = newValue.replace(pattern, '[poistettu]')
      }
      if (reason !== row.reason || oldValue !== (row.old_value_json ?? '') || newValue !== (row.new_value_json ?? '')) {
        this.db.run('UPDATE correction SET reason = ?, old_value_json = ?, new_value_json = ? WHERE id = ?', reason, oldValue || null, newValue || null, row.id)
      }
    }
  }

  exportPerson(personId: string) {
    const person = this.db.get<PersonRow>('SELECT * FROM person WHERE id = ?', personId)
    if (!person) throw new AppError('NOT_FOUND', 'Person not found')
    const entries = this.db.all<EntryRow>('SELECT * FROM entry WHERE person_id = ?', personId)
    const consents = this.db.all<Row>('SELECT * FROM consent WHERE person_id = ?', personId)
    return { person, entries, consents }
  }

  exportErtx() {
    const bytes = packErtx(this.db.snapshot(), { format_version: ERTX_FORMAT_VERSION, app_version: '0.1.0', schema_version: 1 })
    return Buffer.from(bytes)
  }

  async importErtx(bytes: Uint8Array) {
    const savedPin = this.db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM event LIMIT 1')?.pin_hash ?? null
    const unpacked = await unpackErtx(bytes).catch((error: unknown) => {
      throw new AppError('VALIDATION_ERROR', error instanceof ErtxError ? error.message : 'Could not read archive')
    })
    const data = unpacked.data as Record<string, Row[]>
    this.db.tx(() => {
      for (const table of ['tie_resolution', 'correction', 'timing_event', 'consent', 'entry', 'club_alias', 'person', 'club', 'category', 'timing_point', 'device', 'race', 'event']) {
        this.db.run(`DELETE FROM ${table}`)
      }
      for (const [table, rows] of Object.entries(data)) {
        if (table === 'schema_meta') continue
        for (const row of rows) {
          if (table === 'event') delete row.pin_hash
          const keys = Object.keys(row)
          this.db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((key) => row[key]))
        }
      }
      this.db.run('UPDATE event SET pin_hash = ?', savedPin)
    })
  }

  state() {
    const event = this.db.get<EventRow>('SELECT id, name, organizer, location, date_start, timezone, sport, locale_default, settings_json, pin_hash IS NOT NULL AS has_pin FROM event LIMIT 1')
    return {
      event,
      races: this.races(),
      categories: this.categories(),
      counts: {
        entries: this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entry')?.n ?? 0,
        consents: this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM consent')?.n ?? 0,
        clubs: this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM club')?.n ?? 0,
        timing: this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM timing_event')?.n ?? 0,
      },
    }
  }

  /** Drive one Kuulan hölkkä race-day action. */
  perform(action: Record<string, unknown>) {
    const type = String(action.type)
    if (action.at) this.clock.set(parseIsoMs(String(action.at)))
    switch (type) {
      case 'confirm_club_suggestion':
        return this.confirmClubSuggestion(String(action.raw), String(action.club), Boolean(action.add_alias), String(action.reason))
      case 'create_club':
        return this.createClub({ raw: String(action.raw), abbreviation: String(action.abbreviation), name: String(action.name), municipality: String(action.municipality ?? '') })
      case 'resolve_abbreviation_conflict':
        return this.resolveAbbreviationConflict({
          raw: String(action.raw), abbreviation: String(action.abbreviation), resolution: action.resolution === 'same_club' ? 'same_club' : 'different',
          clubId: String(action.club), addAlias: Boolean(action.add_alias), reason: String(action.reason),
        })
      case 'merge_clubs':
        return this.mergeClubs(String(action.source), String(action.target), Boolean(action.add_alias), String(action.reason))
      case 'change_bib':
        return this.changeBib(Number(action.bib_from), Number(action.bib_to), String(action.reason))
      case 'set_status':
        return this.setStatus(Number(action.bib), String(action.status), String(action.reason))
      case 'change_race_rejected': {
        try {
          this.changeRace(Number(action.bib), String(action.race), undefined, 'yritys')
        } catch (error) {
          if (error instanceof AppError && error.code === action.expect_error) return { error: error.code }
          throw error
        }
        throw new AppError('VALIDATION_ERROR', 'Expected the race change to be rejected')
      }
      case 'change_race': {
        const result = this.changeRace(Number(action.bib), String(action.race), action.bib_to == null ? undefined : Number(action.bib_to), String(action.reason))
        if (action.expect_category && result.categoryId !== action.expect_category) {
          throw new AppError('VALIDATION_ERROR', `Expected category ${action.expect_category} got ${result.categoryId}`)
        }
        return result
      }
      case 'set_start_offset':
        return this.setStartOffset(Number(action.bib), Number(action.offset_ms), String(action.reason))
      case 'start':
        return this.startRace(String(action.race), parseIsoMs(String(action.at)), false)
      case 'register_late': {
        const person = action.person as { first_name: string; last_name: string; gender: 'F' | 'M' | 'X'; birth_date: string; email?: string }
        const result = this.registerLate({
          firstName: person.first_name, lastName: person.last_name, gender: person.gender, birthDate: person.birth_date, email: person.email,
          clubQuery: String(action.club_query ?? ''), raceId: String(action.race), bib: Number(action.bib), consent: action.consent_long_term === 'kyllä',
        })
        if (String(action.expect_club ?? '') !== String(result.clubId ?? '')) {
          throw new AppError('VALIDATION_ERROR', `Expected club ${action.expect_club} got ${result.clubId}`)
        }
        return result
      }
      case 'finish_tap':
        return this.recordFinish({ id: String(action.tap_id), timeMs: parseIsoMs(String(action.at)), bib: action.bib == null ? null : Number(action.bib), mode: String(action.mode ?? 'time_first'), deviceId: String(action.device ?? this.deviceId) })
      case 'copy_time':
        return this.copyTime(String(action.source_tap_id), Number(action.bib), String(action.reason))
      case 'assign_bib':
        return this.assignBib(String(action.tap_id), Number(action.bib), String(action.reason))
      case 'void':
        return this.voidTap(String(action.tap_id), String(action.reason))
      case 'check_lock_blocked': {
        const blockers = this.lockBlockers(String(action.race))
        const expected = action.expect_blockers as string[]
        if (JSON.stringify(blockers) !== JSON.stringify(expected)) {
          throw new AppError('LOCK_BLOCKED', `Blockers mismatch for ${action.race}: ${blockers.join(', ')}`, { blockers, expected })
        }
        return { blockers }
      }
      case 'confirm_tie_order':
        return this.confirmTie({
          raceId: String(action.race),
          displayTime: String(action.display_time),
          orderBibs: action.order as number[][],
          basis: 'finish_judge',
          reason: String(action.reason),
        })
      case 'lock':
        return this.lockRace(String(action.race))
      case 'edit_after_lock_rejected':
        try {
          this.setStatus(201, 'dns', 'ei pitäisi onnistua')
        } catch (error) {
          if (error instanceof AppError && error.code === 'EVENT_LOCKED') return { error: error.code }
          throw error
        }
        throw new AppError('VALIDATION_ERROR', 'Expected EVENT_LOCKED')
      default:
        throw new AppError('VALIDATION_ERROR', `Unknown action ${type}`)
    }
  }
}

export interface CsvEntry {
  etunimi: string; sukunimi: string; sukupuoli: string; syntymaaika: string; syntymavuosi: string
  seura: string; seuran_lyhenne: string; matka: string; numero: string; sahkoposti: string
  pitkaaikainen_tallennus: string; suostumuksen_antaja: string
}

function parseEntries(csvText: string): CsvEntry[] {
  const { parseCsv } = requireParser()
  return parseCsv(csvText) as unknown as CsvEntry[]
}

function requireParser(): { parseCsv: (text: string) => Record<string, string>[] } {
  return { parseCsv: parseCsvLazy }
}

function parseCsvLazy(text: string): Record<string, string>[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i]
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ';') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const headers = rows[0]
  return rows.slice(1).filter((cells) => cells.some(Boolean)).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => { record[header] = cells[index] ?? '' })
    return record
  })
}

function mapGender(value: string): 'F' | 'M' | 'X' {
  if (value === 'N' || value === 'F') return 'F'
  if (value === 'M') return 'M'
  return 'X'
}

function personFromCsv(row: CsvEntry) {
  return {
    gender: mapGender(row.sukupuoli),
    birthDate: row.syntymaaika || null,
    birthYear: row.syntymavuosi ? Number(row.syntymavuosi) : null,
  }
}

function validateRow(row: CsvEntry, referenceYear: string): string[] {
  const errors: string[] = []
  const year = Number(row.syntymavuosi)
  const current = Number(referenceYear) || new Date().getFullYear()
  if (!row.etunimi || !row.sukunimi) errors.push('name')
  if (!['N', 'M', 'F', 'X'].includes(row.sukupuoli)) errors.push('gender')
  if (!year || year < 1900 || year > current) errors.push('birth_year')
  const bib = Number(row.numero)
  if (!bib || bib <= 0) errors.push('bib')
  if (!row.matka) errors.push('race')
  return errors
}
