// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { useApp } from './context.js'
import type { TieGroup } from './types.js'

function useTieOrder(initial: number[]) {
  const [bibs, setBibs] = useState<number[]>(initial)
  const [equal, setEqual] = useState(false)
  function move(bib: number, direction: number) {
    setEqual(false)
    setBibs((current) => moveBib(current, bib, direction))
  }
  function dropOn(target: number, from: number) {
    setEqual(false)
    setBibs((current) => dropBib(current, target, from))
  }
  return { bibs, equal, setEqual, move, dropOn }
}

function moveBib(current: number[], bib: number, direction: number): number[] {
  const index = current.indexOf(bib)
  const next = index + direction
  if (index < 0 || next < 0 || next >= current.length) return current
  const copy = [...current]
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item!)
  return copy
}

function dropBib(current: number[], target: number, from: number): number[] {
  const copy = current.filter((bib) => bib !== from)
  copy.splice(copy.indexOf(target), 0, from)
  return copy
}

function TieMembers({ bibs, names, move, dropOn }: {
  bibs: number[]
  names: Map<number, string>
  move: (bib: number, direction: number) => void
  dropOn: (target: number, from: number) => void
}) {
  const { t } = useApp()
  return (
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
  )
}

function TieBasis({ basis, onBasis }: { basis: string; onBasis: (basis: string) => void }) {
  const { t } = useApp()
  return (
    <div className="segment" role="radiogroup" aria-label={t('ties.basisTitle')}>
      {(['finish_judge', 'organizer', 'photo', 'video'] as const).map((item) => (
        <button key={item} type="button" role="radio" aria-checked={basis === item} className={basis === item ? '' : 'secondary'} data-testid={`tie-basis-${item}`} onClick={() => onBasis(item)}>
          {t(`ties.basis.${item}`)}
        </button>
      ))}
    </div>
  )
}

export function TieCard({ group }: { group: TieGroup }) {
  const { t, run } = useApp()
  const initial = useMemo(() => group.members.map((member) => member.bib).filter((bib): bib is number => bib != null), [group])
  const { bibs, equal, setEqual, move, dropOn } = useTieOrder(initial)
  const [basis, setBasis] = useState(group.basis ?? '')
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState(false)
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(false), 5000); return () => window.clearTimeout(timer) }, [toast])

  const names = new Map(group.members.flatMap((member) => member.bib == null ? [] : [[member.bib, member.name] as const]))
  return (
    <article className="card" data-testid={`tie-${group.raceId}-${group.displayTime}`} data-status={group.status}>
      <h2>{group.raceId} · {group.displayTime}</h2>
      <p>{group.status === 'confirmed' ? t('ties.confirmed') : t('ties.unconfirmed')}</p>
      <TieMembers bibs={bibs} names={names} move={move} dropOn={dropOn} />
      <TieBasis basis={basis} onBasis={setBasis} />
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

