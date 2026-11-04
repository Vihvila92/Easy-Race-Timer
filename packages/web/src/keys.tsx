// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import type { MessageKey } from '@ert/i18n'
import { Button } from './ui/components.js'
import { useApp } from './context.js'

/** Plain-language recovery guide. Shown with the printed recovery key. */
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
      <Button data-testid="recovery-print" onClick={() => window.print()}>{t('keys.print')}</Button>
    </div>
  )
}

export type UnlockNotice =
  | 'failed'
  | 'wait'
  | 'checksum'
  | 'params'
  | 'header'
  | 'new-admin'
  | 'old-copies'
  | 'single-admin'
  | 'temporary'
  | 'rotated'

const NOTICE_KEYS: Record<UnlockNotice, MessageKey> = {
  failed: 'unlock.failed',
  wait: 'unlock.wait',
  checksum: 'unlock.recoveryChecksum',
  params: 'unlock.paramsRejected',
  header: 'unlock.headerInvalid',
  'new-admin': 'unlock.newAdminPassword',
  'old-copies': 'keys.oldCopies',
  'single-admin': 'keys.singleAdmin',
  temporary: 'keys.temporaryPassword',
  rotated: 'keys.rotateLeftover',
}

/** The recovery key is rendered only while this print view is on screen. */
export function UnlockPanel({
  mode,
  notice,
  recoveryKey,
}: {
  mode: 'password' | 'recovery' | 'print'
  notice?: UnlockNotice
  recoveryKey?: string
}) {
  const { t } = useApp()
  const [printed, setPrinted] = useState(mode === 'print' ? recoveryKey ?? '' : '')
  useEffect(() => {
    if (mode !== 'print') return undefined
    const clear = () => setPrinted('')
    window.addEventListener('afterprint', clear)
    return () => {
      window.removeEventListener('afterprint', clear)
      clear()
    }
  }, [mode])
  const noticeKey = notice ? NOTICE_KEYS[notice] : undefined
  return (
    <section data-testid="unlock-panel">
      {mode === 'print' ? (
        <>
          {printed ? <p data-testid="recovery-groups">{printed}</p> : null}
          <RecoveryGuide />
        </>
      ) : null}
      {noticeKey ? <p role="alert" data-testid="unlock-notice">{t(noticeKey)}</p> : null}
    </section>
  )
}
