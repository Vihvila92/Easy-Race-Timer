// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useEffect, useState } from 'react'
import { api, clientNow, createTapId, deviceNow, localDeviceId, nextTapLabel, readClockOffset, syncServerClock } from './api.js'
import { useApp } from './context.js'
import { flush, pendingCount, recordTap } from './queue.js'

type Text = (key: MessageKey, vars?: Record<string, string | number>) => string

function useClockOffset(): number {
  const [offsetMs, setOffsetMs] = useState(() => readClockOffset()?.offsetMs ?? 0)
  useEffect(() => {
    const apply = () => { void syncServerClock().then((sample) => setOffsetMs(sample?.offsetMs ?? readClockOffset()?.offsetMs ?? 0)) }
    apply()
    window.addEventListener('online', apply)
    return () => window.removeEventListener('online', apply)
  }, [])
  return offsetMs
}

function useFinishSync(reload: () => Promise<void>, setQueued: (count: number) => void): void {
  useEffect(() => {
    let released = false
    let sentinel: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then((lock) => { if (!released) sentinel = lock }).catch(() => undefined)
    const sync = () => { flush().then(() => pendingCount()).then(setQueued).then(() => reload()).catch(() => undefined) }
    sync()
    window.addEventListener('online', sync)
    return () => { released = true; window.removeEventListener('online', sync); void sentinel?.release() }
  }, [reload, setQueued])
}

function useToastTimer(toast: string, setToast: (value: string) => void): void {
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timer)
  }, [toast, setToast])
}

function unconfirmedTies(ties: { status: string }[] | undefined): number {
  return ties?.filter((group) => group.status === 'unconfirmed').length ?? 0
}

async function saveTap(input: {
  bib: string
  mode: 'time_first' | 'bib_first'
  t: Text
  reload: () => Promise<void>
  setBib: (value: string) => void
  setLastId: (value: string) => void
  setLastLabel: (value: string) => void
  setQueued: (value: number) => void
  setToast: (value: string) => void
}): Promise<void> {
  const timeMs = clientNow()
  const deviceTimeMs = deviceNow()
  const id = createTapId()
  const label = nextTapLabel()
  const numeric = input.bib.trim() ? Number(input.bib) : null
  input.setLastId(id)
  input.setLastLabel(label)
  const outcome = await recordTap({ id, deviceId: localDeviceId(), timeMs, deviceTimeMs, bib: numeric, mode: input.mode, label })
  input.setQueued(await pendingCount())
  if (!outcome.synced) {
    input.setToast(input.t('common.offline'))
    input.setBib('')
    return
  }
  input.setToast(toastNotice(outcome.flags, numeric, input.t))
  input.setBib('')
  await input.reload()
}

type NoticeFlag = 'before_start' | 'unknown_bib' | 'duplicate'

/**
 * One notice for a finish flag.
 * The checklist mentions an unknown bib before a duplicate.
 * The toast mentions a duplicate first, and only when the tap has a bib number.
 * `finish.recorded` stays at the toast call: the checklist never falls through to it.
 */
function finishNotice(input: {
  flags: string[]
  bib: number | null
  t: Text
  order: readonly NoticeFlag[]
  requireBib: boolean
}): string | undefined {
  const { flags, bib, t, order, requireBib } = input
  const notice = order.find((flag) => flags.includes(flag) && (!requireBib || flag === 'before_start' || bib != null))
  if (notice === 'before_start') return t('finish.beforeStart', { bib: bib ?? '' })
  if (notice === 'unknown_bib') return t('finish.unknown', { bib: bib ?? '' })
  if (notice === 'duplicate') return t('finish.duplicate', { bib: bib ?? '' })
  return undefined
}

function checklistNotice(flags: string[], bib: number | null, t: Text): string {
  return finishNotice({ flags, bib, t, order: ['before_start', 'unknown_bib', 'duplicate'], requireBib: false }) ?? ''
}

function toastNotice(flags: string[], numeric: number | null, t: Text): string {
  return finishNotice({ flags, bib: numeric, t, order: ['before_start', 'duplicate', 'unknown_bib'], requireBib: true }) ?? t('finish.recorded')
}

function FinishLists() {
  const { t, data } = useApp()
  const timing = data?.timing ?? []
  const review = timing.filter((event) => event.flags.some((flag) => flag === 'duplicate' || flag === 'unknown_bib' || flag === 'before_start'))
  const logged = timing.filter((event) => (event.label || event.id).startsWith('F')).slice(-8).reverse()
  return (
    <>
      <h2>{t('finish.review')}</h2>
      <ul data-testid="finish-review">
        {review.map((event) => (
          <li key={event.id} data-testid={`finish-review-${event.id}`}>{checklistNotice(event.flags, event.bib, t)}</li>
        ))}
      </ul>
      <ul data-testid="finish-log">
        {logged.map((event) => (
          <li key={event.id} data-testid={`finish-row-${event.id}`} data-label={event.label || event.id} data-id={event.id} data-sync="ok">{event.label || event.id} · {event.bib ?? '—'} · {event.voided ? t('corrections.void') : t('finish.synced')}</li>
        ))}
      </ul>
    </>
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
  const offsetMs = useClockOffset()
  useFinishSync(reload, setQueued)
  useToastTimer(toast, setToast)
  const waiting = unconfirmedTies(data?.ties)
  const clockSkew = Math.abs(offsetMs) > 1000
  const tap = () => saveTap({ bib, mode, t, reload, setBib, setLastId, setLastLabel, setQueued, setToast })

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
      <FinishLists />
      {toast && (
        <div className="toast" role="status" data-testid="finish-recorded">
          <span>{toast}</span>
          {lastId && <button type="button" data-testid="finish-undo" onClick={() => api('/api/v1/corrections/void', { method: 'POST', body: JSON.stringify({ tapId: lastId, reason: t('action.undo') }) }).then(() => reload())}>{t('action.undo')}</button>}
        </div>
      )}
    </section>
  )
}
