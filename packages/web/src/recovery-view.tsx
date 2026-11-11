// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useApp } from './context.js'
import { useHeadingFocus } from './focus-heading.js'
import { acknowledgeKey, keyFailure } from './key-client.js'
import { Banner, Button, Checkbox, RecoveryKeyDisplay } from './ui/components.js'

/** Plain-language recovery guide. Shown with setup, regeneration, and the printed page. */
export function RecoveryGuide() {
  const { t } = useApp()
  return (
    <div data-testid="recovery-guide">
      <p>{t('keys.guide.print')}</p>
      <p>{t('keys.guide.store')}</p>
      <p>{t('keys.guide.use')}</p>
      <p>{t('keys.guide.lost')}</p>
      <p data-testid="recovery-unrecoverable">{t('unlock.unrecoverable')}</p>
      <p data-testid="recovery-pair">{t('keys.pairFiles')}</p>
    </div>
  )
}

/** The recovery key is rendered only while this print view is on screen. */
export function RecoveryPrint({
  recoveryKey,
  generation,
  onAcknowledged,
  onKeyHidden,
  extra,
}: {
  recoveryKey: string
  generation: number
  onAcknowledged: () => void
  onKeyHidden: () => void
  extra?: ReactNode
}) {
  const { t } = useApp()
  const heading = useHeadingFocus()
  const [shown, setShown] = useState(recoveryKey)
  const [acked, setAcked] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const hide = () => {
      setShown('')
      onKeyHidden()
    }
    window.addEventListener('afterprint', hide)
    return () => window.removeEventListener('afterprint', hide)
  }, [onKeyHidden])
  const confirm = () => {
    acknowledgeKey(generation).then(() => onAcknowledged()).catch((error: unknown) => {
      const failure = keyFailure(error)
      setNotice(t(failure.key, failure.seconds ? { seconds: failure.seconds } : undefined))
    })
  }
  return (
    <section data-testid="recovery-print" className="ui-section">
      <h1 ref={heading} tabIndex={-1}>{t('keys.printTitle')}</h1>
      <RecoveryKeyDisplay value={shown} />
      <RecoveryGuide />
      {extra}
      <Banner tone="warning" testId="keys-old-copies">{t('keys.oldCopies')}</Banner>
      {notice ? <Banner tone="danger" role="alert" testId="unlock-notice">{notice}</Banner> : null}
      <form className="ui-section" onSubmit={(event) => { event.preventDefault(); if (acked) confirm() }}>
        <Checkbox id="recovery-ack" label={t('keys.ack')} checked={acked} onChange={setAcked} testId="recovery-ack" />
        <div className="ui-actions">
          <Button type="button" data-testid="recovery-print-button" onClick={() => window.print()}>{t('keys.print')}</Button>
          <Button type="submit" data-testid="recovery-ack-submit" disabled={!acked}>{t('keys.continue')}</Button>
        </div>
      </form>
    </section>
  )
}
