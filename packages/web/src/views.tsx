// SPDX-License-Identifier: AGPL-3.0-only
import { formatDate } from '@ert/i18n'
import { useEffect, useState } from 'react'
import { ApiError, api, clockMs } from './api.js'
import { useApp } from './context.js'
import { licenseUrl, sourceCodeUrl } from './source-link.js'
import { Banner, TextLink } from './ui/components.js'
import { TieCard } from './tie-card.js'

export { Entries } from './entries-view.js'
export { Finish } from './finish-view.js'
export { ImportView } from './import-view.js'
export { Results } from './results-view.js'

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
        <p><TextLink href="#/import" testId="wizard-next-import">{t('wizard.importNext')}</TextLink></p>
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

export function PrintView() {
  const { t, locale, data } = useApp()
  const [html, setHtml] = useState('')
  useEffect(() => {
    if (!data?.event) return undefined
    let current = true
    api<string>(`/api/v1/results?format=html&locale=${locale}`).then((next) => {
      if (current) setHtml(next)
    }).catch(() => {
      if (current) setHtml('')
    })
    return () => { current = false }
  }, [locale, data])
  return (
    <section>
      <h1>{t('print.title')}</h1>
      <p className="lead">{t('print.lead')}</p>
      <iframe title={t('print.title')} className="print-frame" data-testid="print-frame" srcDoc={html} />
    </section>
  )
}

export function About() {
  const { t } = useApp()
  return (
    <section data-testid="about">
      <h1>{t('about.title')}</h1>
      <p className="lead" data-testid="about-version">{t('about.version', { version: __ERT_VERSION__ })}</p>
      <p className="ui-break" data-testid="about-revision">{t('about.revision', { revision: __ERT_SOURCE_REF__ })}</p>
      <div className="ui-actions">
        <TextLink href={sourceCodeUrl(__ERT_SOURCE_REF__)} rel="noreferrer" testId="about-source">{t('common.source')}</TextLink>
        <TextLink href={licenseUrl(__ERT_SOURCE_REF__)} rel="noreferrer" testId="about-license-link">{t('about.licenseLink')}</TextLink>
      </div>
      <Banner tone="info" testId="about-license">{t('about.license')}</Banner>
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
