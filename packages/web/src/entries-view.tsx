// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { api } from './api.js'
import { ClubLabel } from './club-label.js'
import { useApp } from './context.js'
import { Checkbox } from './ui/components.js'

export function Entries() {
  const { t, data } = useApp()
  if (!data) return <p>{t('common.loading')}</p>
  return (
    <section>
      <h1>{t('entries.title')}</h1>
      <BibChange />
      <StatusChange />
      <OffsetChange />
      <RaceChange />
      <LateEntry />
      <EntryTable />
    </section>
  )
}

function BibChange() {
  const { t, run } = useApp()
  const [bibFrom, setBibFrom] = useState('')
  const [bibTo, setBibTo] = useState('')
  const [reason, setReason] = useState('')
  return (
    <div className="card">
      <h2>{t('entries.changeBib')}</h2>
      <div className="row">
        <input aria-label={t('entries.bib')} data-testid="bib-from" value={bibFrom} onChange={(event) => setBibFrom(event.target.value)} />
        <input aria-label={t('entries.changeBib')} data-testid="bib-to" value={bibTo} onChange={(event) => setBibTo(event.target.value)} />
        <input aria-label={t('entries.reason')} data-testid="bib-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" data-testid="bib-save" onClick={() => run(() => api('/api/v1/entries/change-bib', { method: 'POST', body: JSON.stringify({ bibFrom: Number(bibFrom), bibTo: Number(bibTo), reason }) }))}>{t('action.save')}</button>
      </div>
    </div>
  )
}

function StatusChange() {
  const { t, run } = useApp()
  const [statusBib, setStatusBib] = useState('')
  const [status, setStatus] = useState('dns')
  const [statusReason, setStatusReason] = useState('')
  return (
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
  )
}

function OffsetChange() {
  const { t, run } = useApp()
  const [offsetBib, setOffsetBib] = useState('')
  const [offsetMs, setOffsetMs] = useState('')
  const [offsetReason, setOffsetReason] = useState('')
  return (
    <div className="card">
      <h2>{t('entries.offset')}</h2>
      <div className="row">
        <input aria-label={t('entries.bib')} data-testid="offset-bib" value={offsetBib} onChange={(event) => setOffsetBib(event.target.value)} />
        <input aria-label={t('entries.offsetMs')} data-testid="offset-ms" value={offsetMs} onChange={(event) => setOffsetMs(event.target.value)} />
        <input aria-label={t('entries.reason')} data-testid="offset-reason" value={offsetReason} onChange={(event) => setOffsetReason(event.target.value)} />
        <button type="button" data-testid="offset-save" onClick={() => run(() => api('/api/v1/entries/offset', { method: 'POST', body: JSON.stringify({ bib: Number(offsetBib), offsetMs: Number(offsetMs), reason: offsetReason }) }))}>{t('action.save')}</button>
      </div>
    </div>
  )
}

function RaceChange() {
  const { t, run } = useApp()
  const [raceBib, setRaceBib] = useState('')
  const [raceId, setRaceId] = useState('R8')
  const [raceBibTo, setRaceBibTo] = useState('')
  const [raceReason, setRaceReason] = useState('')
  return (
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
  )
}

type LateForm = {
  first: string
  last: string
  gender: string
  birth: string
  email: string
  club: string
  race: string
  bib: string
  consent: boolean
}

function LateEntry() {
  const { t, run } = useApp()
  const [late, setLate] = useState<LateForm>({ first: '', last: '', gender: 'M', birth: '', email: '', club: '', race: 'R4', bib: '', consent: false })
  const [clubHit, setClubHit] = useState('')
  return (
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
        <input aria-label={t('entries.clubQuery')} data-testid="late-club" value={late.club} onChange={(event) => { void lookupClub(event.target.value, setLate, late, setClubHit) }} />
        <span data-testid="late-club-hit">{clubHit}</span>
        <input aria-label={t('entries.changeRace')} data-testid="late-race" value={late.race} onChange={(event) => setLate({ ...late, race: event.target.value })} />
        <input aria-label={t('entries.bib')} data-testid="late-bib" value={late.bib} onChange={(event) => setLate({ ...late, bib: event.target.value })} />
        <Checkbox id="late-consent" label={t('entries.consentText')} checked={late.consent} testId="late-consent" onChange={(consent) => setLate({ ...late, consent })} />
        <button type="button" data-testid="late-save" onClick={() => run(() => api('/api/v1/entries/late', { method: 'POST', body: JSON.stringify({ firstName: late.first, lastName: late.last, gender: late.gender, birthDate: late.birth, email: late.email, clubQuery: late.club, raceId: late.race, bib: Number(late.bib), consent: late.consent }) }))}>{t('action.save')}</button>
      </div>
    </div>
  )
}

async function lookupClub(club: string, setLate: (value: LateForm) => void, late: LateForm, setClubHit: (id: string) => void) {
  setLate({ ...late, club })
  const hits = await api<{ id: string }[]>(`/api/v1/clubs?q=${encodeURIComponent(club)}`)
  setClubHit(hits[0]?.id ?? '')
}

function EntryTable() {
  const { t, data } = useApp()
  if (!data) return null
  return (
    <table>
      <thead><tr><th>{t('entries.bib')}</th><th>{t('entries.name')}</th><th>{t('entries.club')}</th><th>{t('entries.category')}</th><th>{t('entries.status')}</th></tr></thead>
      <tbody>
        {data.entries.map((entry) => {
          const club = data.clubs.find((item) => item.id === entry.club_id)
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
  )
}
