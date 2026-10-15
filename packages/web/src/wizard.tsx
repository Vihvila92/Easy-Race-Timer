import { createId } from '@ert/core'
import { kidsAndAdultsTemplate } from '@ert/sports'
import { useState } from 'react'
import { api } from './api.js'
import { useApp } from './context.js'

function todayLocal(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function localIso(date: string, time: string): string {
  const probe = new Date(`${date}T${time}:00`)
  const offsetMin = -probe.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  return `${date}T${time}:00${sign}${hours}:${minutes}`
}

export function Wizard() {
  const { t, run, locale } = useApp()
  const template = kidsAndAdultsTemplate()
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayLocal)
  const [place, setPlace] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [starts, setStarts] = useState<Record<string, string>>(() => Object.fromEntries(template.races.map((race) => [race.id, race.start.slice(0, 5)])))
  const ready = name.trim().length > 0 && date.length > 0

  async function create() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Helsinki'
    await api('/api/v1/events/import', {
      method: 'POST',
      body: JSON.stringify({
        id: `EV_${date.replace(/-/g, '')}_${createId().slice(-8)}`,
        name: name.trim(),
        organizer: organizer.trim(),
        location: place.trim(),
        date,
        timezone: zone,
        sport: 'run',
        locale_default: locale,
        races: template.races.map((race) => ({
          id: race.id,
          name: { fi: race.nameFi, en: race.nameEn },
          distance_m: race.distanceM,
          start_mode: 'mass',
          scheduled_start: localIso(date, starts[race.id] || race.start.slice(0, 5)),
          open_category_id: race.id === 'R8' ? 'K8' : null,
        })),
        categories: template.categories.map((category) => ({
          id: category.id,
          race_id: category.raceId,
          gender: category.gender,
          min_age: category.minAge,
          max_age: category.maxAge,
          ranked: category.ranked,
          auto_assign: category.autoAssign,
          name: { fi: category.nameFi, en: category.nameEn },
          description: { fi: category.descriptionFi, en: category.descriptionEn },
        })),
      }),
    })
    window.location.hash = '#/office'
  }

  return (
    <section data-testid="wizard">
      <p className="wizard-steps" aria-live="polite">{t('wizard.step', { step })}</p>
      <h1>{t('wizard.title')}</h1>
      <p className="lead">{t('wizard.lead')}</p>
      <p><a href="#/import">{t('wizard.importFile')}</a></p>
      {step === 1 && (
        <div className="card stack">
          <label className="stack" htmlFor="wizard-name">{t('wizard.name')}
            <input id="wizard-name" data-testid="wizard-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
          </label>
          <label className="stack" htmlFor="wizard-date">{t('wizard.date')}
            <input id="wizard-date" data-testid="wizard-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="stack" htmlFor="wizard-place">{t('wizard.place')}
            <input id="wizard-place" data-testid="wizard-place" value={place} onChange={(event) => setPlace(event.target.value)} />
          </label>
          <label className="stack" htmlFor="wizard-organizer">{t('wizard.organizer')}
            <input id="wizard-organizer" data-testid="wizard-organizer" value={organizer} onChange={(event) => setOrganizer(event.target.value)} />
          </label>
          <button type="button" data-testid="wizard-next" disabled={!ready} onClick={() => setStep(2)}>{t('wizard.next')}</button>
        </div>
      )}
      {step === 2 && (
        <div className="card stack">
          <p>{t('wizard.distancesLead')}</p>
          {template.races.map((race) => (
            <label className="stack" key={race.id} htmlFor={`wizard-start-${race.id}`}>
              {locale === 'en' ? race.nameEn : race.nameFi}
              <input id={`wizard-start-${race.id}`} data-testid={`wizard-start-${race.id}`} type="time" value={starts[race.id]} onChange={(event) => setStarts((current) => ({ ...current, [race.id]: event.target.value }))} />
            </label>
          ))}
          <div className="row">
            <button type="button" className="secondary" data-testid="wizard-back" onClick={() => setStep(1)}>{t('wizard.back')}</button>
            <button type="button" data-testid="wizard-next" onClick={() => setStep(3)}>{t('wizard.next')}</button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="card stack">
          <p>{t('wizard.reviewLead')}</p>
          <p data-testid="wizard-summary"><strong>{name.trim()}</strong> · {date} · {place}</p>
          <ul>
            {template.races.map((race) => (
              <li key={race.id}>{locale === 'en' ? race.nameEn : race.nameFi} · {starts[race.id]}</li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="secondary" data-testid="wizard-back" onClick={() => setStep(2)}>{t('wizard.back')}</button>
            <button type="button" data-testid="wizard-create" onClick={() => run(create)}>{t('wizard.create')}</button>
          </div>
        </div>
      )}
    </section>
  )
}
