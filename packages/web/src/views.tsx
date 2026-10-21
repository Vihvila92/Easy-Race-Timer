import { formatDate } from '@ert/i18n'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, clientNow, clockMs, createTapId, deviceNow, localDeviceId, nextTapLabel, readClockOffset, syncServerClock } from './api.js'
import { useApp } from './context.js'
import { flush, pendingCount, recordTap } from './queue.js'
import type { ClubMatch, Preview, Suggestion, TieGroup } from './types.js'

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="stack">
      <span className="muted">{label}</span>
      {children}
    </label>
  )
}

export function Office() {
  const { t, data, run, locale } = useApp()
  const [pin, setPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  if (!data) return <p>{t('common.loading')}</p>
  const event = data.event
  return (
    <section>
      <h1>{t('office.title')}</h1>
      <p className="lead">{t('office.lead')}</p>
      {event ? (
        <div className="card">
          <h2>{event.name}</h2>
          <p data-testid="office-date">{event.organizer} · {event.location} · {formatDate(event.date_start, locale)}</p>
          <p data-testid="consent-count">{data.counts.consents}</p>
          <ul>
            {data.races.map((race) => (
              <li key={race.id}>
                {locale === 'en' ? race.name_en : race.name_fi}
                {race.locked_at ? ` · ${t('office.locked')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {event && data.counts.entries === 0 && (
        <p><a href="#/import" data-testid="wizard-next-import">{t('wizard.importNext')}</a></p>
      )}
      <div className="card">
        <h2>{t('office.ageBasisTitle')}</h2>
        <div className="segment">
          <button type="button" className="secondary" data-testid="office-age-birth_date" onClick={() => run(() => api('/api/v1/settings/age-basis', { method: 'POST', body: JSON.stringify({ basis: 'birth_date', apply: false }) }))}>{t('office.ageBasis.birth_date')}</button>
          <button type="button" className="secondary" data-testid="office-age-birth_year" onClick={() => run(() => api('/api/v1/settings/age-basis', { method: 'POST', body: JSON.stringify({ basis: 'birth_year', apply: false }) }))}>{t('office.ageBasis.birth_year')}</button>
        </div>
        <p>{t('office.pin')}</p>
        <div className="row">
          {event?.has_pin ? <input aria-label={t('pin.current')} data-testid="office-pin-current" value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} inputMode="numeric" /> : null}
          <input id="pin" aria-label={t('office.pin')} data-testid="office-pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" />
          <button type="button" className="secondary" data-testid="office-pin-save" onClick={() => run(() => api('/api/v1/settings/pin', { method: 'POST', body: JSON.stringify(event?.has_pin ? { pin, currentPin } : { pin }) }))}>{t('office.pinSet')}</button>
          <button type="button" data-testid="retention-run" onClick={() => run(() => api('/api/v1/retention/run', { method: 'POST', body: JSON.stringify({ confirm: true }) }))}>{t('office.retention')}</button>
        </div>
      </div>
    </section>
  )
}

export function ImportView() {
  const { t, run } = useApp()
  const [preview, setPreview] = useState<Preview | null>(() => {
    const saved = sessionStorage.getItem('ert-preview')
    return saved ? JSON.parse(saved) as Preview : null
  })
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [basis, setBasis] = useState<'birth_date' | 'birth_year'>('birth_date')
  const [csv, setCsv] = useState('')

  function remember(next: Preview) {
    sessionStorage.setItem('ert-preview', JSON.stringify(next))
    setPreview(next)
  }

  return (
    <section>
      <h1>{t('import.title')}</h1>
      <p className="lead">{t('import.lead')}</p>
      <div className="card">
        <Field id="event-file" label={t('import.event')}>
          <input id="event-file" data-testid="event-file" type="file" accept="application/json" onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const text = await file.text()
            await run(() => api('/api/v1/events/import', { method: 'POST', body: text }))
          }} />
        </Field>
        <Field id="clubs-file" label={t('import.clubs')}>
          <input id="clubs-file" data-testid="clubs-file" type="file" accept="application/json" onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const parsed = JSON.parse(await file.text()) as { clubs: unknown[] }
            await run(() => api('/api/v1/clubs/import', { method: 'POST', body: JSON.stringify({ clubs: parsed.clubs }) }))
          }} />
        </Field>
        <Field id="csv-file" label={t('import.csv')}>
          <input id="csv-file" data-testid="csv-file" type="file" accept=".csv,text/csv" onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const text = await file.text()
            setCsv(text)
            const next = await run(() => api<Preview>('/api/v1/entries/import/preview', { method: 'POST', body: JSON.stringify({ csv: text }) }))
            remember(next)
          }} />
        </Field>
        {preview && (
          <>
            <p data-testid="import-summary">{t('import.summary', { count: preview.count, errors: preview.errors })}</p>
            <button type="button" data-testid="import-commit" onClick={() => run(() => api('/api/v1/entries/import', { method: 'POST', body: JSON.stringify({ csv }) }))}>{t('import.commit')}</button>
            <h2>{t('import.clubsHeading')}</h2>
            {preview.clubs.map((match) => <ClubDecision key={`${match.name}\0${match.abbreviation}`} match={match} />)}
            <div className="segment">
              <button type="button" className="secondary" data-testid="age-basis-birth_date" onClick={async () => {
                const rows = await run(() => api<Suggestion[]>('/api/v1/settings/age-basis', { method: 'POST', body: JSON.stringify({ basis: 'birth_date', apply: false }) }))
                setBasis('birth_date')
                setSuggestions(rows)
              }}>{t('office.ageBasis.birth_date')}</button>
              <button type="button" className="secondary" data-testid="age-basis-birth_year" onClick={async () => {
                const rows = await run(() => api<Suggestion[]>('/api/v1/settings/age-basis', { method: 'POST', body: JSON.stringify({ basis: 'birth_year', apply: false }) }))
                setBasis('birth_year')
                setSuggestions(rows)
              }}>{t('office.ageBasis.birth_year')}</button>
            </div>
            <table data-testid="suggestions" data-basis={basis}>
              <tbody>
                {suggestions.map((row) => (
                  <tr key={row.bib} data-testid={`suggestion-${row.bib}`}>
                    <td>{row.bib}</td>
                    <td data-testid={`suggestion-${row.bib}-category`}>{row.categoryId}</td>
                    <td>{row.warnings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={String(row.bib)}>
                    <td>{row.bib}</td>
                    <td>{row.name}</td>
                    <td data-testid={`preview-${row.bib}-birth_date`}>{row.birth_date.categoryId}</td>
                    <td data-testid={`preview-${row.bib}-birth_date-warn`}>{row.birth_date.warnings}</td>
                    <td data-testid={`preview-${row.bib}-birth_year`}>{row.birth_year.categoryId}</td>
                    <td data-testid={`preview-${row.bib}-birth_year-warn`}>{row.birth_year.warnings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  )
}

function ClubDecision({ match }: { match: ClubMatch }) {
  const { t, run } = useApp()
  const [city, setCity] = useState('')
  const [reason, setReason] = useState('')
  const needs = match.type === 'fuzzy_suggestion' || match.type === 'new' || match.type === 'abbreviation_conflict'
  if (!needs && match.type !== 'abbreviation' && match.type !== 'name' && match.type !== 'normalized_name' && match.type !== 'none') return null
  return (
    <article className="card" data-testid="club-match" data-name={match.name} data-abbr={match.abbreviation} data-type={match.type} data-club-id={match.clubId}>
      <strong>{match.name || '—'} {match.abbreviation}</strong>
      <p className="muted">{match.type} · {match.rows}</p>
      {match.type === 'fuzzy_suggestion' && (
        <div className="row">
          <input aria-label={t('entries.reason')} data-testid="club-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" data-testid="club-confirm" onClick={() => run(() => api('/api/v1/club-actions/confirm', { method: 'POST', body: JSON.stringify({ raw: match.name, clubId: match.clubId, addAlias: true, reason }) }))}>{t('action.confirm')}</button>
        </div>
      )}
      {match.type === 'new' && (
        <div className="row">
          <input aria-label={t('clubs.city')} data-testid="club-city" value={city} onChange={(event) => setCity(event.target.value)} />
          <button type="button" data-testid="club-create" onClick={() => run(() => api('/api/v1/clubs', { method: 'POST', body: JSON.stringify({ raw: match.name, abbreviation: match.abbreviation, name: match.name, municipality: city }) }))}>{t('clubs.add')}</button>
        </div>
      )}
      {match.type === 'abbreviation_conflict' && (
        <div className="row">
          <input aria-label={t('entries.reason')} data-testid="club-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" data-testid="club-same" onClick={() => run(() => api('/api/v1/club-actions/conflict', { method: 'POST', body: JSON.stringify({ raw: match.name, abbreviation: match.abbreviation, resolution: 'same_club', clubId: match.clubId, addAlias: true, reason }) }))}>{t('clubs.same')}</button>
        </div>
      )}
    </article>
  )
}

export function Entries() {
  const { t, data, run } = useApp()
  const [bibFrom, setBibFrom] = useState('')
  const [bibTo, setBibTo] = useState('')
  const [reason, setReason] = useState('')
  const [statusBib, setStatusBib] = useState('')
  const [status, setStatus] = useState('dns')
  const [statusReason, setStatusReason] = useState('')
  const [offsetBib, setOffsetBib] = useState('')
  const [offsetMs, setOffsetMs] = useState('')
  const [offsetReason, setOffsetReason] = useState('')
  const [raceBib, setRaceBib] = useState('')
  const [raceId, setRaceId] = useState('R8')
  const [raceBibTo, setRaceBibTo] = useState('')
  const [raceReason, setRaceReason] = useState('')
  const [late, setLate] = useState({ first: '', last: '', gender: 'M', birth: '', email: '', club: '', race: 'R4', bib: '', consent: false })
  const [clubHit, setClubHit] = useState('')
  if (!data) return <p>{t('common.loading')}</p>
  const clubName = (id: string | null) => data.clubs.find((club) => club.id === id)
  return (
    <section>
      <h1>{t('entries.title')}</h1>
      <div className="card">
        <h2>{t('entries.changeBib')}</h2>
        <div className="row">
          <input aria-label={t('entries.bib')} data-testid="bib-from" value={bibFrom} onChange={(event) => setBibFrom(event.target.value)} />
          <input aria-label={t('entries.changeBib')} data-testid="bib-to" value={bibTo} onChange={(event) => setBibTo(event.target.value)} />
          <input aria-label={t('entries.reason')} data-testid="bib-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" data-testid="bib-save" onClick={() => run(() => api('/api/v1/entries/change-bib', { method: 'POST', body: JSON.stringify({ bibFrom: Number(bibFrom), bibTo: Number(bibTo), reason }) }))}>{t('action.save')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('entries.status')}</h2>
        <div className="row">
          <input aria-label={t('entries.bib')} data-testid="status-bib" value={statusBib} onChange={(event) => setStatusBib(event.target.value)} />
          <select aria-label={t('entries.status')} data-testid="status-value" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="dns">DNS</option>
            <option value="dnf">DNF</option>
            <option value="dsq">DSQ</option>
            <option value="registered">{t('status.registered')}</option>
          </select>
          <input aria-label={t('entries.reason')} data-testid="status-reason" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} />
          <button type="button" data-testid="status-save" onClick={() => run(() => api('/api/v1/entries/status', { method: 'POST', body: JSON.stringify({ bib: Number(statusBib), status, reason: statusReason }) }))}>{t('action.save')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('entries.offset')}</h2>
        <div className="row">
          <input aria-label={t('entries.bib')} data-testid="offset-bib" value={offsetBib} onChange={(event) => setOffsetBib(event.target.value)} />
          <input aria-label={t('entries.offsetMs')} data-testid="offset-ms" value={offsetMs} onChange={(event) => setOffsetMs(event.target.value)} />
          <input aria-label={t('entries.reason')} data-testid="offset-reason" value={offsetReason} onChange={(event) => setOffsetReason(event.target.value)} />
          <button type="button" data-testid="offset-save" onClick={() => run(() => api('/api/v1/entries/offset', { method: 'POST', body: JSON.stringify({ bib: Number(offsetBib), offsetMs: Number(offsetMs), reason: offsetReason }) }))}>{t('action.save')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('entries.changeRace')}</h2>
        <div className="row">
          <input aria-label={t('entries.bib')} data-testid="race-bib" value={raceBib} onChange={(event) => setRaceBib(event.target.value)} />
          <input aria-label={t('entries.changeRace')} data-testid="race-id" value={raceId} onChange={(event) => setRaceId(event.target.value)} />
          <input aria-label={t('entries.bib')} data-testid="race-bib-to" value={raceBibTo} onChange={(event) => setRaceBibTo(event.target.value)} />
          <input aria-label={t('entries.reason')} data-testid="race-reason" value={raceReason} onChange={(event) => setRaceReason(event.target.value)} />
          <button type="button" data-testid="race-save" onClick={() => run(() => api('/api/v1/entries/race', { method: 'POST', body: JSON.stringify({ bib: Number(raceBib), race: raceId, bibTo: raceBibTo ? Number(raceBibTo) : undefined, reason: raceReason || 'yritys' }) }))}>{t('action.save')}</button>
        </div>
      </div>
      <div className="card">
        <h2>{t('entries.late')}</h2>
        <div className="row">
          <input aria-label={t('entries.name')} data-testid="late-first" value={late.first} onChange={(event) => setLate({ ...late, first: event.target.value })} />
          <input aria-label={t('entries.name')} data-testid="late-last" value={late.last} onChange={(event) => setLate({ ...late, last: event.target.value })} />
          <select aria-label={t('entries.category')} data-testid="late-gender" value={late.gender} onChange={(event) => setLate({ ...late, gender: event.target.value })}>
            <option value="F">N</option>
            <option value="M">M</option>
          </select>
          <input aria-label={t('office.ageBasis.birth_date')} data-testid="late-birth" value={late.birth} onChange={(event) => setLate({ ...late, birth: event.target.value })} />
          <input aria-label="email" data-testid="late-email" value={late.email} onChange={(event) => setLate({ ...late, email: event.target.value })} />
          <input aria-label={t('entries.clubQuery')} data-testid="late-club" value={late.club} onChange={async (event) => {
            const club = event.target.value
            setLate({ ...late, club })
            const hits = await api<{ id: string; abbreviation: string | null; name: string }[]>(`/api/v1/clubs?q=${encodeURIComponent(club)}`)
            setClubHit(hits[0]?.id ?? '')
          }} />
          <span data-testid="late-club-hit">{clubHit}</span>
          <input aria-label={t('entries.changeRace')} data-testid="late-race" value={late.race} onChange={(event) => setLate({ ...late, race: event.target.value })} />
          <input aria-label={t('entries.bib')} data-testid="late-bib" value={late.bib} onChange={(event) => setLate({ ...late, bib: event.target.value })} />
          <label><input data-testid="late-consent" type="checkbox" checked={late.consent} onChange={(event) => setLate({ ...late, consent: event.target.checked })} /> {t('entries.consentText')}</label>
          <button type="button" data-testid="late-save" onClick={() => run(() => api('/api/v1/entries/late', { method: 'POST', body: JSON.stringify({ firstName: late.first, lastName: late.last, gender: late.gender, birthDate: late.birth, email: late.email, clubQuery: late.club, raceId: late.race, bib: Number(late.bib), consent: late.consent }) }))}>{t('action.save')}</button>
        </div>
      </div>
      <table>
        <thead><tr><th>{t('entries.bib')}</th><th>{t('entries.name')}</th><th>{t('entries.club')}</th><th>{t('entries.category')}</th><th>{t('entries.status')}</th></tr></thead>
        <tbody>
          {data.entries.map((entry) => {
            const club = clubName(entry.club_id)
            return (
              <tr key={entry.id}>
                <td>{entry.bib}</td>
                <td>{entry.display_name}</td>
                <td><ClubLabel abbr={club?.abbreviation ?? ''} name={club?.name ?? ''} /></td>
                <td>{entry.category_id}</td>
                <td>{entry.status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function ClubLabel({ abbr, name }: { abbr: string; name: string }) {
  return (
    <>
      <span className="club-abbr" title={name}>{abbr || name}</span>
      <span className="club-full">{name || abbr}</span>
    </>
  )
}

export function Start() {
  const { t, data, run, locale } = useApp()
  const [confirmId, setConfirmId] = useState('')
  if (!data) return <p>{t('common.loading')}</p>
  return (
    <section>
      <h1>{t('start.title')}</h1>
      <p className="lead">{t('start.lead')}</p>
      {data.races.map((race) => (
        <div className="card" key={race.id}>
          <h2>{locale === 'en' ? race.name_en : race.name_fi}</h2>
          <button type="button" className="start-button" data-testid={`start-${race.id}`} onClick={() => run(async () => {
            const timeMs = await clockMs()
            try {
              await api(`/api/v1/races/${race.id}/start`, { method: 'POST', body: JSON.stringify({ timeMs, confirm: false }) })
            } catch (error) {
              if (error instanceof ApiError) setConfirmId(race.id)
              throw error
            }
          })}>{t('start.button')}</button>
          {race.actual_start_ms != null && <p>{t('start.done')}</p>}
          {confirmId === race.id && (
            <button type="button" data-testid={`start-confirm-${race.id}`} onClick={() => run(async () => {
              await api(`/api/v1/races/${race.id}/start`, { method: 'POST', body: JSON.stringify({ timeMs: await clockMs(), confirm: true }) })
              setConfirmId('')
            })}>{t('start.confirm')}</button>
          )}
        </div>
      ))}
    </section>
  )
}

export function Finish() {
  const { t, data, reload } = useApp()
  const [mode, setMode] = useState<'time_first' | 'bib_first'>('time_first')
  const [bib, setBib] = useState('')
  const [toast, setToast] = useState('')
  const [lastId, setLastId] = useState('')
  const [lastLabel, setLastLabel] = useState('')
  const [queued, setQueued] = useState(0)
  const [offsetMs, setOffsetMs] = useState(() => readClockOffset()?.offsetMs ?? 0)
  const waiting = data?.ties?.filter((group) => group.status === 'unconfirmed').length ?? 0
  const clockSkew = Math.abs(offsetMs) > 1000

  useEffect(() => {
    const apply = () => { void syncServerClock().then((sample) => setOffsetMs(sample?.offsetMs ?? readClockOffset()?.offsetMs ?? 0)) }
    apply()
    window.addEventListener('online', apply)
    return () => window.removeEventListener('online', apply)
  }, [])

  useEffect(() => {
    let released = false
    let sentinel: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then((lock) => { if (!released) sentinel = lock }).catch(() => undefined)
    const sync = () => { flush().then(() => pendingCount()).then(setQueued).then(() => reload()).catch(() => undefined) }
    sync()
    window.addEventListener('online', sync)
    return () => { released = true; window.removeEventListener('online', sync); void sentinel?.release() }
  }, [reload])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function tap() {
    const id = createTapId()
    const label = nextTapLabel()
    const deviceTimeMs = deviceNow()
    const timeMs = clientNow()
    const numeric = bib.trim() ? Number(bib) : null
    setLastId(id)
    setLastLabel(label)
    const outcome = await recordTap({ id, deviceId: localDeviceId(), timeMs, deviceTimeMs, bib: numeric, mode, label })
    setQueued(await pendingCount())
    if (!outcome.synced) {
      setToast(t('common.offline'))
      setBib('')
      return
    }
    if (outcome.flags.includes('before_start')) setToast(t('finish.beforeStart', { bib: numeric ?? '' }))
    else if (numeric != null && outcome.flags.includes('duplicate')) setToast(t('finish.duplicate', { bib: numeric }))
    else if (numeric != null && outcome.flags.includes('unknown_bib')) setToast(t('finish.unknown', { bib: numeric }))
    else setToast(t('finish.recorded'))
    setBib('')
    await reload()
  }

  return (
    <section className="finish-layout">
      <h1>{t('finish.title')}</h1>
      <p className="lead">{t('finish.lead')}</p>
      {clockSkew && <p className="error" role="status" data-testid="clock-offset">{t('finish.clockOffset', { seconds: Math.round(Math.abs(offsetMs) / 1000) })}</p>}
      {waiting > 0 && <p data-testid="finish-ties">{t('ties.waiting', { count: waiting })}</p>}
      <div className="segment" role="group" aria-label={t('finish.bibFirst')}>
        <button type="button" className={mode === 'time_first' ? '' : 'secondary'} data-testid="finish-mode-time" onClick={() => setMode('time_first')}>{t('finish.tap')}</button>
        <button type="button" className={mode === 'bib_first' ? '' : 'secondary'} data-testid="finish-mode-bib" onClick={() => setMode('bib_first')}>{t('finish.bibFirst')}</button>
      </div>
      <input aria-label={t('finish.bib')} data-testid="finish-bib" inputMode="numeric" value={bib} onChange={(event) => setBib(event.target.value)} />
      <button type="button" className="finish-tap" data-testid="finish-tap" aria-label={t('finish.tapLabel')} onClick={() => { tap().catch(() => setToast(t('common.offline'))) }}>{t('finish.tap')}</button>
      {/* // Rendered once #144 adds the shortcut */}
      <p className="queue-note" data-testid="queue-count">{t('common.offline')}: {queued}</p>
      {lastLabel && <p data-testid="finish-last">{lastLabel}</p>}
      <h2>{t('finish.review')}</h2>
      <ul data-testid="finish-review">
        {(data?.timing ?? []).filter((event) => event.flags.includes('duplicate') || event.flags.includes('unknown_bib') || event.flags.includes('before_start')).map((event) => (
          <li key={event.id} data-testid={`finish-review-${event.id}`}>
            {event.flags.includes('before_start')
              ? t('finish.beforeStart', { bib: event.bib ?? '' })
              : event.flags.includes('unknown_bib')
                ? t('finish.unknown', { bib: event.bib ?? '' })
                : t('finish.duplicate', { bib: event.bib ?? '' })}
          </li>
        ))}
      </ul>
      <ul data-testid="finish-log">
        {(data?.timing ?? []).filter((event) => (event.label || event.id).startsWith('F')).slice(-8).reverse().map((event) => (
          <li key={event.id} data-testid={`finish-row-${event.id}`} data-label={event.label || event.id} data-id={event.id} data-sync="ok">{event.label || event.id} · {event.bib ?? '—'} · {event.voided ? t('corrections.void') : t('finish.synced')}</li>
        ))}
      </ul>
      {toast && (
        <div className="toast" role="status" data-testid="finish-recorded">
          <span>{toast}</span>
          {lastId && <button type="button" data-testid="finish-undo" onClick={() => api('/api/v1/corrections/void', { method: 'POST', body: JSON.stringify({ tapId: lastId, reason: t('action.undo') }) }).then(() => reload())}>{t('action.undo')}</button>}
        </div>
      )}
    </section>
  )
}

export function Corrections() {
  const { t, data, run } = useApp()
  const [tapId, setTapId] = useState('')
  const [bib, setBib] = useState('')
  const [reason, setReason] = useState('')
  if (!data) return <p>{t('common.loading')}</p>
  return (
    <section>
      <h1>{t('corrections.title')}</h1>
      <p className="lead">{t('corrections.lead')}</p>
      <div className="card row">
        <input aria-label={t('finish.tap')} data-testid="corr-tap" value={tapId} onChange={(event) => setTapId(event.target.value)} />
        <input aria-label={t('entries.bib')} data-testid="corr-bib" value={bib} onChange={(event) => setBib(event.target.value)} />
        <input aria-label={t('entries.reason')} data-testid="corr-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" data-testid="corr-assign" onClick={() => run(() => api('/api/v1/corrections/assign-bib', { method: 'POST', body: JSON.stringify({ tapId, bib: Number(bib), reason }) }))}>{t('corrections.assign')}</button>
        <button type="button" className="secondary" data-testid="corr-void" onClick={() => run(() => api('/api/v1/corrections/void', { method: 'POST', body: JSON.stringify({ tapId, reason }) }))}>{t('corrections.void')}</button>
        <button type="button" className="secondary" data-testid="corr-copy" onClick={() => run(() => api('/api/v1/corrections/copy-time', { method: 'POST', body: JSON.stringify({ sourceTapId: tapId, bib: Number(bib), reason }) }))}>{t('corrections.copy')}</button>
        <button type="button" className="secondary" data-testid="corr-restore" onClick={() => run(() => api('/api/v1/corrections/restore', { method: 'POST', body: JSON.stringify({ tapId, reason }) }))}>{t('corrections.restore')}</button>
      </div>
      <ul>
        {data.timing.map((event) => (
          <li key={event.id}><button type="button" className="secondary" data-id={event.id} data-label={event.label || event.id} onClick={() => setTapId(event.id)}>{event.label || event.id}</button> {event.bib ?? '—'} {event.voided ? t('corrections.void') : ''}</li>
        ))}
      </ul>
    </section>
  )
}

export function Ties() {
  const { t, data } = useApp()
  if (!data) return <p>{t('common.loading')}</p>
  return (
    <section>
      <h1>{t('ties.title')}</h1>
      <p className="lead">{t('ties.lead')}</p>
      {(data.ties ?? []).length === 0 && <p>{t('ties.empty')}</p>}
      {(data.ties ?? []).map((group) => <TieCard key={`${group.raceId}-${group.displayTime}`} group={group} />)}
    </section>
  )
}

function TieCard({ group }: { group: TieGroup }) {
  const { t, run } = useApp()
  const initial = useMemo(() => group.members.map((member) => member.bib).filter((bib): bib is number => bib != null), [group])
  const [bibs, setBibs] = useState<number[]>(initial)
  const [equal, setEqual] = useState(false)
  const [basis, setBasis] = useState(group.basis ?? '')
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState(false)
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(false), 5000); return () => window.clearTimeout(timer) }, [toast])

  function move(bib: number, direction: number) {
    setEqual(false)
    setBibs((current) => {
      const index = current.indexOf(bib)
      const next = index + direction
      if (index < 0 || next < 0 || next >= current.length) return current
      const copy = [...current]
      const [item] = copy.splice(index, 1)
      copy.splice(next, 0, item)
      return copy
    })
  }

  function dropOn(target: number, from: number) {
    setEqual(false)
    setBibs((current) => {
      const copy = current.filter((bib) => bib !== from)
      const index = copy.indexOf(target)
      copy.splice(index, 0, from)
      return copy
    })
  }

  const names = new Map(group.members.map((member) => [member.bib, member.name]))
  return (
    <article className="card" data-testid={`tie-${group.raceId}-${group.displayTime}`} data-status={group.status}>
      <h2>{group.raceId} · {group.displayTime}</h2>
      <p>{group.status === 'confirmed' ? t('ties.confirmed') : t('ties.unconfirmed')}</p>
      <ol>
        {bibs.map((bib) => (
          <li
            key={bib}
            draggable
            data-testid={`tie-member-${bib}`}
            onDragStart={(event) => event.dataTransfer.setData('text/plain', String(bib))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); dropOn(bib, Number(event.dataTransfer.getData('text/plain'))) }}
          >
            <span>{bib} {names.get(bib)}</span>
            <button type="button" className="secondary" data-testid={`tie-up-${bib}`} aria-label={t('ties.moveUp')} onClick={() => move(bib, -1)}>{t('ties.moveUp')}</button>
            <button type="button" className="secondary" data-testid={`tie-down-${bib}`} aria-label={t('ties.moveDown')} onClick={() => move(bib, 1)}>{t('ties.moveDown')}</button>
          </li>
        ))}
      </ol>
      <div className="segment" role="radiogroup" aria-label={t('ties.basisTitle')}>
        {(['finish_judge', 'organizer', 'photo', 'video'] as const).map((item) => (
          <button key={item} type="button" role="radio" aria-checked={basis === item} className={basis === item ? '' : 'secondary'} data-testid={`tie-basis-${item}`} onClick={() => setBasis(item)}>
            {t(`ties.basis.${item}`)}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="secondary" data-testid="tie-equal" onClick={() => setEqual(true)}>{t('ties.equal')}</button>
        <button type="button" className="secondary" data-testid="tie-split" onClick={() => setEqual(false)}>{t('ties.split')}</button>
        <input aria-label={t('entries.reason')} data-testid="tie-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" data-testid="tie-confirm" disabled={!basis || !reason.trim()} onClick={() => run(() => api('/api/v1/ties/confirm', {
          method: 'POST',
          body: JSON.stringify({
            raceId: group.raceId,
            displayTime: group.displayTime,
            orderBibs: equal ? [bibs] : bibs.map((bib) => [bib]),
            basis,
            reason,
          }),
        })).then(() => setToast(true))}>{t('ties.confirm')}</button>
        {group.status === 'confirmed' && <button type="button" className="secondary" data-testid="tie-reopen" onClick={() => run(() => api('/api/v1/ties/undo', { method: 'POST', body: JSON.stringify({ raceId: group.raceId, displayTime: group.displayTime, reason: reason || t('ties.reopen') }) }))}>{t('ties.reopen')}</button>}
      </div>
      {toast && (
        <div className="toast" role="status" data-testid="tie-undo-toast">
          <span>{t('ties.confirmed')}</span>
          <button type="button" data-testid="tie-undo" onClick={() => run(() => api('/api/v1/ties/undo', { method: 'POST', body: JSON.stringify({ raceId: group.raceId, displayTime: group.displayTime, reason: t('action.undo') }) }))}>{t('action.undo')}</button>
        </div>
      )}
    </article>
  )
}

export function Clubs() {
  const { t, data, run } = useApp()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ id: string; abbreviation: string | null; name: string }[]>([])
  const [abbr, setAbbr] = useState('')
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [reason, setReason] = useState('')
  if (!data) return <p>{t('common.loading')}</p>
  return (
    <section>
      <h1>{t('clubs.title')}</h1>
      <p className="lead">{t('clubs.lead')}</p>
      <div className="card row">
        <input aria-label={t('action.search')} data-testid="club-search" value={query} onChange={async (event) => {
          setQuery(event.target.value)
          setHits(await api(`/api/v1/clubs?q=${encodeURIComponent(event.target.value)}`))
        }} />
        <ul>{hits.map((hit) => <li key={hit.id} data-testid="club-hit">{hit.abbreviation} {hit.name}</li>)}</ul>
      </div>
      <div className="card row">
        <input aria-label={t('clubs.abbr')} data-testid="club-new-abbr" value={abbr} onChange={(event) => setAbbr(event.target.value)} />
        <input aria-label={t('clubs.name')} data-testid="club-new-name" value={name} onChange={(event) => setName(event.target.value)} />
        <input aria-label={t('clubs.city')} data-testid="club-new-city" value={city} onChange={(event) => setCity(event.target.value)} />
        <button type="button" data-testid="club-new-save" onClick={() => run(() => api('/api/v1/clubs', { method: 'POST', body: JSON.stringify({ abbreviation: abbr, name, municipality: city }) }))}>{t('clubs.add')}</button>
      </div>
      <h2>{t('clubs.duplicates')}</h2>
      {data.duplicates.map((pair) => {
        const source = data.clubs.find((club) => club.id === pair.sourceId)
        const target = data.clubs.find((club) => club.id === pair.targetId)
        return (
          <div className="pair" key={`${pair.sourceId}-${pair.targetId}`}>
            <article className="card"><h2>{source?.name}</h2><p>{source?.abbreviation}</p><p>{source?.entries}</p></article>
            <article className="card">
              <h2>{target?.name}</h2>
              <p>{target?.abbreviation}</p>
              <input aria-label={t('entries.reason')} data-testid={`merge-reason-${pair.sourceId}`} value={reason} onChange={(event) => setReason(event.target.value)} />
              <button type="button" data-testid={`merge-${pair.sourceId}`} onClick={() => run(() => api(`/api/v1/clubs/${pair.sourceId}/merge`, { method: 'POST', body: JSON.stringify({ targetId: pair.targetId, reason, addAlias: true }) }))}>{t('clubs.merge')}</button>
            </article>
          </div>
        )
      })}
      <ul>
        {data.clubs.map((club) => (
          <li key={club.id}>
            <span data-testid={`club-entries-${club.id}`}>{club.entries}</span> {club.abbreviation} {club.name} {club.status}
            {club.status === 'merged' && <button type="button" className="secondary" data-testid={`unmerge-${club.id}`} onClick={() => run(() => api(`/api/v1/clubs/${club.id}/unmerge`, { method: 'POST', body: JSON.stringify({ reason: reason || t('clubs.undoMerge') }) }))}>{t('clubs.undoMerge')}</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Results() {
  const { t, data, run, locale } = useApp()
  const [race, setRace] = useState('R4')
  const [club, setClub] = useState('')
  const [blockers, setBlockers] = useState<Record<string, string[]>>({})
  if (!data) return <p>{t('common.loading')}</p>
  const needle = club.trim().toLowerCase()
  const matchesClub = (row: { club_abbr: string; club_name: string }) => {
    if (!needle) return true
    const abbr = row.club_abbr.toLowerCase()
    const name = row.club_name.toLowerCase()
    return abbr === needle || name.startsWith(needle)
  }
  const overall = data.results.filter((row) => row.race === race && row.scope === 'overall' && matchesClub(row))
  const visible = data.results.filter((row) => row.race === race && row.scope !== 'overall' && matchesClub(row))
  return (
    <section>
      <h1>{t('results.title')}</h1>
      <p className="lead">{t('results.lead')}</p>
      <div className="row">
        <select aria-label={t('results.overall')} data-testid="results-race" value={race} onChange={(event) => setRace(event.target.value)}>
          {data.races.map((item) => <option key={item.id} value={item.id}>{locale === 'en' ? item.name_en : item.name_fi}</option>)}
        </select>
        <input aria-label={t('results.filter')} data-testid="results-filter" value={club} onChange={(event) => setClub(event.target.value)} />
        <span data-testid="results-count">{overall.length}</span>
        <a href="/api/v1/results?format=csv">{t('results.csv')}</a>
        <button type="button" className="secondary" data-testid="offset-ranked" onClick={() => run(() => api('/api/v1/settings/offset-policy', { method: 'POST', body: JSON.stringify({ policy: 'ranked' }) }))}>{t('office.offset.ranked')}</button>
        <button type="button" className="secondary" data-testid="offset-unranked" onClick={() => run(() => api('/api/v1/settings/offset-policy', { method: 'POST', body: JSON.stringify({ policy: 'unranked' }) }))}>{t('office.offset.unranked')}</button>
        <button type="button" className="secondary" data-testid="offset-open_category" onClick={() => run(() => api('/api/v1/settings/offset-policy', { method: 'POST', body: JSON.stringify({ policy: 'open_category' }) }))}>{t('office.offset.open_category')}</button>
      </div>
      {data.races.map((item) => (
        <div key={item.id} className="row">
          <button type="button" data-testid={`lock-${item.id}`} onClick={async () => {
            try {
              await run(() => api(`/api/v1/races/${item.id}/lock`, { method: 'POST', body: '{}' }))
              setBlockers((current) => ({ ...current, [item.id]: [] }))
            } catch (error) {
              if (error instanceof ApiError && error.code === 'LOCK_BLOCKED') {
                const details = error.details as { blockers?: string[] } | undefined
                setBlockers((current) => ({ ...current, [item.id]: details?.blockers ?? [] }))
              }
            }
          }}>{t('results.lock')} {item.id}</button>
          <ul data-testid={`blockers-${item.id}`}>
            {(blockers[item.id] ?? []).map((blocker) => <li key={blocker} data-testid="blocker"><a href={blocker.startsWith('tie:') ? '#/ties' : '#/entries'}>{blocker}</a></li>)}
          </ul>
        </div>
      ))}
      <h2>{t('results.overall')}</h2>
      <ResultTable rows={overall} />
      {visible.map((row) => row.scope).filter((scope, index, all) => all.indexOf(scope) === index).map((scope) => (
        <div key={scope}>
          <h2>{scope}</h2>
          <ResultTable rows={visible.filter((row) => row.scope === scope)} />
        </div>
      ))}
    </section>
  )
}

function ResultTable({ rows }: { rows: { rank: string; bib: string; name: string; club_abbr: string; club_name: string; category: string; time: string; behind: string; status: string; note: string }[] }) {
  const { t } = useApp()
  if (!rows.length) return <p>{t('results.empty')}</p>
  return (
    <table>
      <thead>
        <tr>
          <th>{t('results.place')}</th><th>{t('entries.bib')}</th><th>{t('entries.name')}</th><th>{t('entries.club')}</th>
          <th>{t('entries.category')}</th><th>{t('results.time')}</th><th>{t('results.behind')}</th><th>{t('entries.status')}</th><th>{t('results.note')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.bib}-${row.category}-${index}`}>
            <td>{row.rank}</td><td>{row.bib}</td><td>{row.name}</td>
            <td><ClubLabel abbr={row.club_abbr} name={row.club_name} /></td>
            <td>{row.category}</td><td>{row.time}</td><td>{row.behind}</td><td>{row.status}</td><td>{row.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PrintView() {
  const { t, locale, data } = useApp()
  const [html, setHtml] = useState('')
  useEffect(() => {
    if (!data?.event) return
    api<string>(`/api/v1/results?format=html&locale=${locale}`).then(setHtml).catch(() => setHtml(''))
  }, [locale, data])
  return (
    <section>
      <h1>{t('print.title')}</h1>
      <p className="lead">{t('print.lead')}</p>
      <iframe title={t('print.title')} data-testid="print-frame" srcDoc={html} style={{ width: '100%', minHeight: '70vh', border: '1px solid var(--line)', borderRadius: 16, background: 'white' }} />
    </section>
  )
}

export function Audit() {
  const { t, data } = useApp()
  if (!data) return <p>{t('common.loading')}</p>
  return (
    <section>
      <h1>{t('audit.title')}</h1>
      {data.audit.length === 0 && <p>{t('audit.empty')}</p>}
      <ul data-testid="audit-log">
        {data.audit.map((row) => <li key={row.id} data-testid="audit-row" data-action={row.action}>{row.reason}</li>)}
      </ul>
    </section>
  )
}
