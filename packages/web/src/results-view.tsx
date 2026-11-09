// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { blockerLink } from './blockers.js'
import { ApiError, api } from './api.js'
import { ClubLabel } from './club-label.js'
import { useApp } from './context.js'
import { TextLink } from './ui/components.js'

function LockControls({ races, blockers, onLock }: {
  races: { id: string }[]
  blockers: Record<string, string[]>
  onLock: (id: string) => Promise<void>
}) {
  const { t, locale } = useApp()
  return (
    <>
      {races.map((item) => (
        <div key={item.id} className="row">
          <button type="button" data-testid={`lock-${item.id}`} onClick={() => { onLock(item.id).catch(() => undefined) }}>{t('results.lock')} {item.id}</button>
          <ul data-testid={`blockers-${item.id}`}>
            {(blockers[item.id] ?? []).map((blocker) => {
              const link = blockerLink(blocker, locale)
              return <li key={blocker} data-testid="blocker"><TextLink href={link.href}>{link.text}</TextLink></li>
            })}
          </ul>
        </div>
      ))}
    </>
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
        <TextLink href="/api/v1/results?format=csv" testId="results-csv">{t('results.csv')}</TextLink>
        <button type="button" className="secondary" data-testid="offset-ranked" onClick={() => run(() => api('/api/v1/settings/offset-policy', { method: 'POST', body: JSON.stringify({ policy: 'ranked' }) }))}>{t('office.offset.ranked')}</button>
        <button type="button" className="secondary" data-testid="offset-unranked" onClick={() => run(() => api('/api/v1/settings/offset-policy', { method: 'POST', body: JSON.stringify({ policy: 'unranked' }) }))}>{t('office.offset.unranked')}</button>
        <button type="button" className="secondary" data-testid="offset-open_category" onClick={() => run(() => api('/api/v1/settings/offset-policy', { method: 'POST', body: JSON.stringify({ policy: 'open_category' }) }))}>{t('office.offset.open_category')}</button>
      </div>
      <LockControls races={data.races} blockers={blockers} onLock={async (id) => {
        try {
          await run(() => api(`/api/v1/races/${id}/lock`, { method: 'POST', body: '{}' }))
          setBlockers((current) => ({ ...current, [id]: [] }))
        } catch (error) {
          if (error instanceof ApiError && error.code === 'LOCK_BLOCKED') {
            const details = error.details as { blockers?: string[] } | undefined
            setBlockers((current) => ({ ...current, [id]: details?.blockers ?? [] }))
          }
        }
      }} />
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
