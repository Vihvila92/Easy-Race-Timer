// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from 'react'
import { api } from './api.js'
import { useApp } from './context.js'
import type { ClubMatch, Preview, Suggestion } from './types.js'

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="stack">
      <span className="muted">{label}</span>
      {children}
    </label>
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
          <ImportPreview preview={preview} csv={csv} basis={basis} suggestions={suggestions} onBasis={async (next) => {
            const rows = await run(() => api<Suggestion[]>('/api/v1/settings/age-basis', { method: 'POST', body: JSON.stringify({ basis: next, apply: false }) }))
            setBasis(next)
            setSuggestions(rows)
          }} />
        )}
      </div>
    </section>
  )
}

const SHOWN_CLUB_MATCH = new Set(['fuzzy_suggestion', 'new', 'abbreviation_conflict', 'abbreviation', 'name', 'normalized_name', 'none'])

function ClubDecision({ match }: { match: ClubMatch }) {
  const { t } = useApp()
  if (!SHOWN_CLUB_MATCH.has(match.type)) return null
  return (
    <article className="card" data-testid="club-match" data-name={match.name} data-abbr={match.abbreviation} data-type={match.type} data-club-id={match.clubId}>
      <strong>{match.name || '—'} {match.abbreviation}</strong>
      <p className="muted">{match.type} · {match.rows}</p>
      <ReasonClub match={match} type="fuzzy_suggestion" testId="club-confirm" label={t('action.confirm')} body={(reason) => ({ raw: match.name, clubId: match.clubId, addAlias: true, reason })} path="/api/v1/club-actions/confirm" />
      <NewClub match={match} />
      <ReasonClub match={match} type="abbreviation_conflict" testId="club-same" label={t('clubs.same')} body={(reason) => ({ raw: match.name, abbreviation: match.abbreviation, resolution: 'same_club', clubId: match.clubId, addAlias: true, reason })} path="/api/v1/club-actions/conflict" />
    </article>
  )
}

function ReasonClub({ match, type, testId, label, path, body }: {
  match: ClubMatch
  type: string
  testId: string
  label: string
  path: string
  body: (reason: string) => Record<string, unknown>
}) {
  const { t, run } = useApp()
  const [reason, setReason] = useState('')
  if (match.type !== type) return null
  return (
    <div className="row">
      <input aria-label={t('entries.reason')} data-testid="club-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      <button type="button" data-testid={testId} onClick={() => run(() => api(path, { method: 'POST', body: JSON.stringify(body(reason)) }))}>{label}</button>
    </div>
  )
}

function NewClub({ match }: { match: ClubMatch }) {
  const { t, run } = useApp()
  const [city, setCity] = useState('')
  if (match.type !== 'new') return null
  return (
    <div className="row">
      <input aria-label={t('clubs.city')} data-testid="club-city" value={city} onChange={(event) => setCity(event.target.value)} />
      <button type="button" data-testid="club-create" onClick={() => run(() => api('/api/v1/clubs', { method: 'POST', body: JSON.stringify({ raw: match.name, abbreviation: match.abbreviation, name: match.name, municipality: city }) }))}>{t('clubs.add')}</button>
    </div>
  )
}

function ImportPreview({ preview, csv, basis, suggestions, onBasis }: {
  preview: Preview
  csv: string
  basis: 'birth_date' | 'birth_year'
  suggestions: Suggestion[]
  onBasis: (basis: 'birth_date' | 'birth_year') => Promise<void>
}) {
  const { t, run } = useApp()
  return (
    <>
      <p data-testid="import-summary">{t('import.summary', { count: preview.count, errors: preview.errors })}</p>
      <button type="button" data-testid="import-commit" onClick={() => run(() => api('/api/v1/entries/import', { method: 'POST', body: JSON.stringify({ csv }) }))}>{t('import.commit')}</button>
      <h2>{t('import.clubsHeading')}</h2>
      {preview.clubs.map((match) => <ClubDecision key={`${match.name}\0${match.abbreviation}`} match={match} />)}
      <div className="segment">
        <button type="button" className="secondary" data-testid="age-basis-birth_date" onClick={() => { onBasis('birth_date').catch(() => undefined) }}>{t('office.ageBasis.birth_date')}</button>
        <button type="button" className="secondary" data-testid="age-basis-birth_year" onClick={() => { onBasis('birth_year').catch(() => undefined) }}>{t('office.ageBasis.birth_year')}</button>
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
      <PreviewRows rows={preview.rows} />
    </>
  )
}

function PreviewRows({ rows }: { rows: Preview['rows'] }) {
  return (
    <table>
      <tbody>
        {rows.map((row) => (
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
  )
}
